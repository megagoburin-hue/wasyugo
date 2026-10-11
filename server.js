const dotenv = require("dotenv");
dotenv.config();

// server.js
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());

const path = require("path");

app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "toppage.html"));
});

const PORT = process.env.PORT || 3000;



// APIキー（Render の環境変数から読み込む）

const HOTPEPPER_KEY = process.env.HOTPEPPER_KEY;

// -----------------------------
// /hotpepper エンドポイント（古いNode.js対応版）
// -----------------------------
app.get("/hotpepper", function (req, res) {
  const lat = req.query.lat;
  const lng = req.query.lng;
  const keyword = req.query.keyword;

  if (!lat || !lng) {
    return res.status(400).json({ error: "lat と lng は必須です" });
  }

  const url = "https://webservice.recruit.co.jp/hotpepper/gourmet/v1/";
  const params = {
    key: HOTPEPPER_KEY,
    lat: lat,
    lng: lng,
    keyword: keyword || "",
    range: 3, 
    format: "json"
  };

  axios.get(url, { params: params })
    .then(function (response) {
      res.json(response.data);
    })
    .catch(function (error) {
      console.error("HotPepper API error:", error);
      res.status(500).json({ error: "HotPepper API の取得に失敗しました" });
    });
});


// -----------------------------
// サーバー起動
// -----------------------------
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
