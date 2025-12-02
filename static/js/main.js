const wallEl = document.getElementById("wall");
const shuffleBtn = document.getElementById("shuffleBtn");
const wallColorPicker = document.getElementById("wallColorPicker");

// Temporary fake gallery data (we will replace this later)
const artworks = [
    { id: 1, size: "xl", color: "#C62626" },
    { id: 2, size: "l",  color: "#0F4762" },
    { id: 3, size: "m",  color: "#1A1A1A" },
    { id: 4, size: "m",  color: "#00495C" },
    { id: 5, size: "l",  color: "#000000" },
    { id: 6, size: "s",  color: "#324040" },
    { id: 7, size: "l",  color: "#5A7F90" },
    { id: 8, size: "m",  color: "#A11A1A" },
    { id: 9, size: "s",  color: "#2A2A2A" },
    { id:10, size: "xs", color: "#3A3A3A" }
];

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function render() {
    wallEl.innerHTML = "";
    const shuffled = shuffle(artworks);

    shuffled.forEach(item => {
        const tile = document.createElement("div");
        tile.classList.add("tile", `tile-${item.size}`);
        tile.style.background = item.color;
        tile.dataset.size = item.size.toUpperCase();
        wallEl.appendChild(tile);
    });
}

shuffleBtn.addEventListener("click", render);

wallColorPicker.addEventListener("input", (e) => {
    wallEl.style.backgroundColor = e.target.value;
});

// Initial render:
render();