const container = document.getElementById("stationContainer");
    let stationCount = container.querySelectorAll(".station").length;
const categorySelect = document.getElementById("category");
const keywordWrapper = document.getElementById("keywordWrapper");

categorySelect.addEventListener("change", () => {
  if (categorySelect.value === "飲食店") {
    keywordWrapper.style.display = "block";
  } else {
    keywordWrapper.style.display = "none";
  }
});
    document.getElementById("addBtn").addEventListener("click", () => {
      if (stationCount >= 4) {
        alert("追加できる駅は4つまでです");
        return;
      }

      stationCount += 1;

      const label = document.createElement("label");
      label.textContent = `駅${stationCount}：`;

      const input = document.createElement("input");
      input.type = "text";
      input.setAttribute("list","stationlist");
      input.className = "station";
      if (stationCount === 3) {
  input.placeholder = "例：池袋駅";   
} else if (stationCount === 4) {
  input.placeholder = "例：東京駅";   
} else {
  input.placeholder = "例：駅名を入力";
}


      container.appendChild(label);
      container.appendChild(input);
      container.appendChild(document.createElement("br"));
      container.appendChild(document.createElement("br"));
    });

    document.getElementById("searchBtn").addEventListener("click", () => {
      const stations = Array.from(document.querySelectorAll(".station"))
                            .map(s => s.value);
      localStorage.setItem("category", document.getElementById("category").value);
      localStorage.setItem("stations", JSON.stringify(stations));
      localStorage.setItem("keyword", document.getElementById("keyword").value);
      localStorage.setItem("price", document.getElementById("price").value);
      localStorage.setItem("radius", document.getElementById("radius").value);

      location.href = "result.html";
      const price = localStorage.getItem("price");
let priceFilteredShops = filteredShops;



if (price) {
  priceFilteredShops = filteredShops.filter(shop => {
    const budget = shop.budget?.average || "";
    const num = Number(budget.replace(/[^0-9]/g, ""));
    return num <= Number(price);
  });
}


    });

    const steps = document.querySelectorAll('.step-box');
const mainImage = document.getElementById('main-image');

steps.forEach(step => {
  // クリックで切り替える場合（ホバーなら 'mouseenter' に変更）
  step.addEventListener('click', () => {
    
    // 1. すべてのステップから active クラスを消去
    steps.forEach(s => s.classList.remove('active'));
    
    // 2. クリックされたステップに active クラスを追加
    step.classList.add('active');
    
    // 3. 画像をふわっと切り替える
    mainImage.style.opacity = 0; // 一度透明にする
    setTimeout(() => {
      mainImage.src = step.dataset.image; // 画像のパスを書き換え
      mainImage.style.opacity = 1;        // 再び表示
    }, 200);
  });
});

// ボタン要素を取得し、クリックイベントを設定
document.getElementById("goBookmarkBtn").addEventListener("click", () => {
  // 別タブで「bookmark.html」を開く
  window.open("bookmark.html", "_blank");
});