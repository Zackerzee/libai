(function () {
  "use strict";

  const MAX_FILES = 3;
  const MAX_FILE_SIZE = 20 * 1024 * 1024;
  const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "pdf"]);

  const form = document.getElementById("printForm");
  const fileInput = document.getElementById("fileInput");
  const fileList = document.getElementById("fileList");
  const contactInput = document.getElementById("contactInput");
  const noteInput = document.getElementById("noteInput");
  const submitButton = document.getElementById("submitButton");
  const statusText = document.getElementById("statusText");
  const successBox = document.getElementById("successBox");
  const orderNo = document.getElementById("orderNo");

  function formatBytes(size) {
    if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
    if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${size} B`;
  }

  function getExtension(file) {
    const match = String(file.name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
    return match ? match[1] : "";
  }

  function setStatus(message) {
    statusText.textContent = message || "";
  }

  function validateFiles(files) {
    if (files.length === 0) return "请上传拼豆图纸图片或 PDF";
    if (files.length > MAX_FILES) return "最多上传 3 个文件";

    for (const file of files) {
      const extension = getExtension(file);
      if (!ALLOWED_EXTENSIONS.has(extension)) {
        return `不支持 ${file.name}，请上传 JPG / PNG / PDF`;
      }
      if (file.size > MAX_FILE_SIZE) {
        return `${file.name} 超过 20MB，请重新选择`;
      }
    }

    return "";
  }

  function renderFiles() {
    const files = Array.from(fileInput.files || []);
    fileList.innerHTML = "";

    for (const file of files) {
      const item = document.createElement("li");
      item.textContent = `${file.name} · ${formatBytes(file.size)}`;
      fileList.appendChild(item);
    }

    const error = validateFiles(files);
    setStatus(error);
    return !error;
  }

  async function submitForm(event) {
    event.preventDefault();
    successBox.classList.remove("is-visible");

    const files = Array.from(fileInput.files || []);
    const fileError = validateFiles(files);
    const contact = contactInput.value.trim();

    if (fileError) {
      setStatus(fileError);
      return;
    }
    if (!contact) {
      setStatus("请填写微信昵称或手机号");
      contactInput.focus();
      return;
    }

    const formData = new FormData();
    for (const file of files) {
      formData.append("files", file, file.name);
    }
    formData.append("contact", contact);
    formData.append("note", noteInput.value.trim());

    submitButton.disabled = true;
    submitButton.textContent = "提交中...";
    setStatus("正在提交图纸，请稍等。");

    try {
      const response = await fetch("/api/print-orders", {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.orderNo) {
        throw new Error(data.error || "提交失败");
      }

      orderNo.textContent = data.orderNo;
      successBox.classList.add("is-visible");
      form.reset();
      fileList.innerHTML = "";
      setStatus("");
    } catch (error) {
      setStatus(error.message || "提交失败，请联系店员");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "提交图纸";
    }
  }

  fileInput.addEventListener("change", renderFiles);
  form.addEventListener("submit", submitForm);
})();
