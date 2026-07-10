# 拼豆计时器 FastAPI 后端核心

这个目录是下一版“前后端解耦计时器”的 Python 后端核心实现。

## 本地运行

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r timer_backend/requirements.txt
uvicorn timer_backend.fastapi_app:app --reload --host 0.0.0.0 --port 8000
```

## API

```text
GET  /api/timer/tables
GET  /api/timer/tables/{table_id}
POST /api/timer/tables/{table_id}/actions
```

Action body:

```json
{ "action": "start" }
{ "action": "pause" }
{ "action": "reset" }
{ "action": "set_total", "total_minutes": 90 }
{ "action": "add_time", "minutes": 60 }
{ "action": "sub_time", "minutes": 15 }
```

## 生产持久化说明

`JsonTimerStore` 适合本地或独立服务器。Vercel / Serverless 的本地文件和进程内存不适合保存桌台状态。

生产上线需要把 `JsonTimerStore` 替换成：

- Redis / Upstash Redis
- Postgres / Neon / Supabase
- Cloudflare R2 JSON 对象存储（低并发可用，需要处理并发写）

后端永远只保存 `end_time`、`is_paused`、`paused_remaining_seconds` 等锚点数据，不做每秒循环。
