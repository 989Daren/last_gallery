document.addEventListener("DOMContentLoaded", () => {
  const modal = document.getElementById("uploadModal");
  const openBtn = document.getElementById("addArtworkBtn");
  const cancelBtn = document.getElementById("cancelUploadBtn");

  if (!modal || !openBtn || !cancelBtn) return;

  function openModal() {
    modal.classList.remove("hidden");
  }

  function closeModal() {
    modal.classList.add("hidden");
  }

  openBtn.addEventListener("click", openModal);
  cancelBtn.addEventListener("click", closeModal);
});