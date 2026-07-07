(function () {
  "use strict";

  const pinInput = document.getElementById("pinInput");
  const loadButton = document.getElementById("loadButton");
  const statusText = document.getElementById("statusText");
  const ordersContainer = document.getElementById("orders");

  function setStatus(message) {
    statusText.textContent = message || "";
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value || "";
    return date.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatBytes(size) {
    if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
    if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${size || 0} B`;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function downloadFile(orderNo, file) {
    const pin = pinInput.value.trim();
    if (!pin) {
      setStatus("请先输入 PIN");
      return;
    }

    const url = `/api/print-orders/download?orderNo=${encodeURIComponent(orderNo)}&file=${encodeURIComponent(file.fileName)}`;
    const response = await fetch(url, {
      headers: {
        "x-print-admin-pin": pin,
      },
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "下载失败");
    }

    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = file.originalName || file.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  }

  function renderOrders(orders) {
    ordersContainer.innerHTML = "";
    if (!orders.length) {
      ordersContainer.innerHTML = '<div class="empty">最近 7 天暂无图纸上传记录。</div>';
      return;
    }

    for (const order of orders) {
      const card = document.createElement("article");
      card.className = "order-card";
      const filesHtml = (order.files || [])
        .map(
          (file) => `
            <div class="file-row">
              <span>${escapeHtml(file.originalName)} · ${formatBytes(file.size)}</span>
              <button class="btn-blue" type="button" data-order="${escapeHtml(order.orderNo)}" data-file="${escapeHtml(file.fileName)}">下载文件</button>
            </div>
          `,
        )
        .join("");

      card.innerHTML = `
        <div class="order-head">
          <div>
            <div class="order-no">${escapeHtml(order.orderNo)}</div>
            <div class="muted">${escapeHtml(formatDate(order.submittedAt))}</div>
          </div>
        </div>
        <div class="meta">
          <div><strong>微信昵称或手机号：</strong>${escapeHtml(order.contact)}</div>
          <div><strong>备注：</strong>${escapeHtml(order.note || "无")}</div>
        </div>
        <div class="files">${filesHtml}</div>
      `;

      for (const button of card.querySelectorAll("button[data-file]")) {
        button.addEventListener("click", async () => {
          const file = (order.files || []).find((item) => item.fileName === button.dataset.file);
          if (!file) return;
          button.disabled = true;
          button.textContent = "下载中...";
          try {
            await downloadFile(order.orderNo, file);
            setStatus("文件已开始下载");
          } catch (error) {
            setStatus(error.message || "下载失败");
          } finally {
            button.disabled = false;
            button.textContent = "下载文件";
          }
        });
      }

      ordersContainer.appendChild(card);
    }
  }

  async function loadOrders() {
    const pin = pinInput.value.trim();
    if (!pin) {
      setStatus("请输入后台 PIN");
      pinInput.focus();
      return;
    }

    loadButton.disabled = true;
    loadButton.textContent = "加载中...";
    setStatus("正在读取最近 7 天订单。");

    try {
      const response = await fetch("/api/print-orders", {
        headers: {
          "x-print-admin-pin": pin,
        },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "读取失败");
      }
      sessionStorage.setItem("printAdminPin", pin);
      renderOrders(Array.isArray(data.orders) ? data.orders : []);
      setStatus("订单已更新。");
    } catch (error) {
      ordersContainer.innerHTML = "";
      setStatus(error.message || "读取失败");
    } finally {
      loadButton.disabled = false;
      loadButton.textContent = "查看订单";
    }
  }

  pinInput.value = sessionStorage.getItem("printAdminPin") || "";
  loadButton.addEventListener("click", loadOrders);
  pinInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") loadOrders();
  });
})();
