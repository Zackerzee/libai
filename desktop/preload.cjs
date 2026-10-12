window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.classList.add("libai-desktop");

  const onlineOnlySelectors = [
    ".nfc-entry",
    ".mentor-timer-entry",
    ".windows-bridge-entry",
    ".nfc-hero-link",
    ".mentor-timer-hero-link",
    ".windows-bridge-hero-link",
  ];

  document.querySelectorAll(onlineOnlySelectors.join(",")).forEach((el) => {
    el.hidden = true;
    el.style.display = "none";
  });

  const title = document.querySelector("title");
  if (title && !title.textContent.includes("本地版")) {
    title.textContent = `${title.textContent} · Windows本地版`;
  }

  const brandSmall = document.querySelector(".brand small");
  if (brandSmall) {
    brandSmall.textContent = "Windows 本地版 · 图片不上传";
  }
});
