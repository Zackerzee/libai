"""
时里白造物多桌台计时后端核心。

运行方式（本地开发）：
  pip install -r timer_backend/requirements.txt
  uvicorn timer_backend.fastapi_app:app --reload --host 0.0.0.0 --port 8000

设计原则：
  - 后端不做 sleep(1) 轮询，只保存 end_time / is_paused 等时间锚点元数据。
  - 前端每次渲染时用 Date.now() 与 end_time 对比计算剩余时间。
  - JsonTimerStore 适合本地或独立服务器；部署到 Serverless 时请替换成 Redis/Postgres/R2 等持久化 Store。
"""

from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


UTC = timezone.utc
DEFAULT_TABLE_COUNT = int(os.getenv("TIMER_TABLE_COUNT", "30"))
DEFAULT_TOTAL_SECONDS = int(os.getenv("TIMER_DEFAULT_SECONDS", str(60 * 60)))
STATE_FILE = Path(os.getenv("TIMER_STATE_FILE", "timer_state.json"))


class TimerStatus(str, Enum):
    IDLE = "IDLE"
    RUNNING = "RUNNING"
    OVERTIME = "OVERTIME"


class TimerAction(str, Enum):
    start = "start"
    pause = "pause"
    reset = "reset"
    set_total = "set_total"
    add_time = "add_time"
    sub_time = "sub_time"


class TableTimer(BaseModel):
    table_id: int
    status: TimerStatus = TimerStatus.IDLE
    total_seconds: int = DEFAULT_TOTAL_SECONDS
    end_time: Optional[datetime] = None
    paused_remaining_seconds: int = 0
    is_paused: bool = False
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class ActionRequest(BaseModel):
    action: TimerAction
    minutes: Optional[int] = Field(default=None, ge=1, le=24 * 60)
    total_minutes: Optional[int] = Field(default=None, ge=1, le=24 * 60)


class TablesResponse(BaseModel):
    server_time: datetime
    tables: List[TableTimer]


class ActionResponse(BaseModel):
    server_time: datetime
    table: TableTimer


def now_utc() -> datetime:
    return datetime.now(UTC)


def as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def clamp_seconds(value: int) -> int:
    return max(0, min(int(value), 24 * 60 * 60))


class JsonTimerStore:
    """
    简单持久化 Store。

    注意：
      - 在本地或传统服务器上，JSON 文件可以持久化。
      - 在 Vercel / Serverless 上，文件系统不是可靠持久化；生产应替换为 Redis/Postgres/R2 Store。
    """

    def __init__(self, state_file: Path, table_count: int) -> None:
        self.state_file = state_file
        self.table_count = table_count
        self.lock = threading.RLock()
        self.tables: Dict[int, TableTimer] = self._load_or_init()

    def _default_tables(self) -> Dict[int, TableTimer]:
        return {table_id: TableTimer(table_id=table_id) for table_id in range(1, self.table_count + 1)}

    def _load_or_init(self) -> Dict[int, TableTimer]:
        if not self.state_file.exists():
            return self._default_tables()

        try:
            raw = json.loads(self.state_file.read_text("utf-8"))
            parsed = {
                int(item["table_id"]): TableTimer.model_validate(item)
                for item in raw.get("tables", [])
                if "table_id" in item
            }
            defaults = self._default_tables()
            defaults.update(parsed)
            return defaults
        except Exception:
            return self._default_tables()

    def _save(self) -> None:
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "saved_at": now_utc().isoformat(),
            "tables": [table.model_dump(mode="json") for table in self.tables.values()],
        }
        self.state_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), "utf-8")

    def list_tables(self) -> List[TableTimer]:
        with self.lock:
            changed = False
            tables = []
            for table in self.tables.values():
                normalized = self._derive_status(table)
                changed = changed or normalized != table
                self.tables[table.table_id] = normalized
                tables.append(normalized)
            if changed:
                self._save()
            return sorted(tables, key=lambda item: item.table_id)

    def get_table(self, table_id: int) -> TableTimer:
        if table_id not in self.tables:
            raise HTTPException(status_code=404, detail="桌台不存在")
        table = self._derive_status(self.tables[table_id])
        self.tables[table_id] = table
        return table

    def apply_action(self, table_id: int, request: ActionRequest) -> TableTimer:
        with self.lock:
            table = self.get_table(table_id)
            current = now_utc()

            if request.action == TimerAction.start:
                table = self._start(table, current)
            elif request.action == TimerAction.pause:
                table = self._pause(table, current)
            elif request.action == TimerAction.reset:
                table = self._reset(table, current)
            elif request.action == TimerAction.set_total:
                if request.total_minutes is None:
                    raise HTTPException(status_code=400, detail="set_total 需要 total_minutes")
                table = self._set_total(table, current, request.total_minutes)
            elif request.action in (TimerAction.add_time, TimerAction.sub_time):
                if request.minutes is None:
                    raise HTTPException(status_code=400, detail="add_time/sub_time 需要 minutes")
                sign = 1 if request.action == TimerAction.add_time else -1
                table = self._shift_time(table, current, sign * request.minutes)

            table.updated_at = current
            table = self._derive_status(table)
            self.tables[table_id] = table
            self._save()
            return table

    def _derive_status(self, table: TableTimer) -> TableTimer:
        table = table.model_copy(deep=True)
        if table.status == TimerStatus.IDLE or table.is_paused or not table.end_time:
            return table

        if as_utc(table.end_time) <= now_utc():
            table.status = TimerStatus.OVERTIME
        else:
            table.status = TimerStatus.RUNNING
        return table

    def _start(self, table: TableTimer, current: datetime) -> TableTimer:
        remaining = table.paused_remaining_seconds if table.is_paused else table.total_seconds
        remaining = clamp_seconds(remaining or table.total_seconds)
        if remaining <= 0:
            raise HTTPException(status_code=400, detail="剩余时间必须大于 0")

        table.status = TimerStatus.RUNNING
        table.end_time = current + timedelta(seconds=remaining)
        table.paused_remaining_seconds = 0
        table.is_paused = False
        return table

    def _pause(self, table: TableTimer, current: datetime) -> TableTimer:
        if table.status == TimerStatus.IDLE or table.is_paused:
            return table

        if table.end_time:
            remaining = int((as_utc(table.end_time) - current).total_seconds())
            table.paused_remaining_seconds = clamp_seconds(remaining)
        else:
            table.paused_remaining_seconds = table.total_seconds

        table.end_time = None
        table.is_paused = True
        table.status = TimerStatus.RUNNING
        return table

    def _reset(self, table: TableTimer, current: datetime) -> TableTimer:
        return TableTimer(table_id=table.table_id, total_seconds=table.total_seconds, updated_at=current)

    def _set_total(self, table: TableTimer, current: datetime, total_minutes: int) -> TableTimer:
        table.total_seconds = clamp_seconds(total_minutes * 60)
        if table.status == TimerStatus.IDLE:
            table.paused_remaining_seconds = 0
            table.end_time = None
            table.is_paused = False
        elif table.is_paused:
            table.paused_remaining_seconds = table.total_seconds
        else:
            table.end_time = current + timedelta(seconds=table.total_seconds)
            table.status = TimerStatus.RUNNING
        return table

    def _shift_time(self, table: TableTimer, current: datetime, minutes_delta: int) -> TableTimer:
        delta_seconds = minutes_delta * 60

        if table.status == TimerStatus.IDLE:
            table.total_seconds = clamp_seconds(table.total_seconds + delta_seconds)
        elif table.is_paused:
            table.paused_remaining_seconds = clamp_seconds(table.paused_remaining_seconds + delta_seconds)
        elif table.end_time:
            table.end_time = as_utc(table.end_time) + timedelta(seconds=delta_seconds)
            if table.end_time > current:
                table.status = TimerStatus.RUNNING
            else:
                table.status = TimerStatus.OVERTIME
        return table


store = JsonTimerStore(STATE_FILE, DEFAULT_TABLE_COUNT)
app = FastAPI(title="Libms Perler Timer API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("TIMER_ALLOWED_ORIGINS", "*").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/api/timer/tables", response_model=TablesResponse)
def list_tables() -> TablesResponse:
    return TablesResponse(server_time=now_utc(), tables=store.list_tables())


@app.get("/api/timer/tables/{table_id}", response_model=ActionResponse)
def get_table(table_id: int) -> ActionResponse:
    return ActionResponse(server_time=now_utc(), table=store.get_table(table_id))


@app.post("/api/timer/tables/{table_id}/actions", response_model=ActionResponse)
def table_action(table_id: int, request: ActionRequest) -> ActionResponse:
    return ActionResponse(server_time=now_utc(), table=store.apply_action(table_id, request))
