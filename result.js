
/* =========================================================
   設定（ここを編集してください）
   ========================================================= */

// NAVITIME (RapidAPI) のAPIキー。RapidAPIで取得したキーをここに貼り付けてください。
// 参考: https://rapidapi.com/navitimejapan-navitimejapan/api/navitime-route-totaalnavi
const NAVITIME_API_KEY = CONFIG.NAVITIME_API_KEY; // ← ここに自分のAPIキーを入力

// HotPepper検索用プロキシサーバー（Render等）のベースURL
const HOTPEPPER_API_BASE = "https://server-1fxn.onrender.com";

// 中間駅の候補として重心付近から何駅を評価するか
const CANDIDATE_COUNT = 5;


// トップページの「レジャー施設カテゴリ」→ Google Places 検索条件の対応表
// HotPepper APIは飲食店専用のため、飲食店以外はGoogle Places (Nearby Search) で検索する
// =========================================================
// 🟢 Places API（New）用のレジャーカテゴリ設定
// =========================================================
//
// mode: "nearby"
//   場所タイプを使って周辺検索する
//
// mode: "text"
//   「カラオケ」などのキーワードで検索する
//
const LEISURE_CATEGORY_CONFIG = {
  "ボウリング": {
    mode: "nearby",
    type: "bowling_alley"
  },

  "ショッピングモール": {
    mode: "nearby",
    type: "shopping_mall"
  },

  "映画館": {
    mode: "nearby",
    type: "movie_theater"
  },

  "カラオケ": {
    mode: "text",
    keyword: "カラオケ"
  },

  "ゲームセンター": {
    mode: "text",
    keyword: "ゲームセンター"
  }
};
/* =========================================================
   グローバル状態
   ========================================================= */
let map = null;
let geocoder = null;
let originMarkers = [];   // 起点駅のマーカー
let midpointMarker = null; // 中間駅のマーカー
let shopMarkers = [];      // 飲食店のマーカー
let currentInfoWindow = null;
let allShops = [];         // HotPepperの検索結果（ジャンル絞り込みのため保持）

/* =========================================================
   Google Maps 初期化（index.htmlのcallback=initMapから呼ばれる）
   ========================================================= */
function initMap() {
  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: 35.681236, lng: 139.767125 },
    zoom: 11
  });
  geocoder = new google.maps.Geocoder();
  runSearch();
}

/* =========================================================
   ユーティリティ
   ========================================================= */
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function setStatus(msg) {
  const el = document.getElementById("info");
  if (el) el.textContent = msg;
}

function clearShopMarkers() {
  shopMarkers.forEach(m => m.setMap(null));
  shopMarkers = [];
}

function clearAllMarkers() {
  originMarkers.forEach(m => m.setMap(null));
  originMarkers = [];
  if (midpointMarker) { midpointMarker.setMap(null); midpointMarker = null; }
  clearShopMarkers();
}

/* =========================================================
   Geocoding：駅名 → 緯度経度
   ========================================================= */
function geocodeStation(name) {
  return new Promise((resolve, reject) => {
    geocoder.geocode({ address: name, region: "jp" }, (results, status) => {
      if (status === "OK" && results[0]) {
        const loc = results[0].geometry.location;
        resolve({ name, lat: loc.lat(), lng: loc.lng() });
      } else {
        reject(new Error(`「${name}」の位置が取得できませんでした`));
      }
    });
  });
}

/* =========================================================
   NAVITIME route_transit：2地点間の所要時間（分）を取得
   ========================================================= */
async function navitimeTransitTime(fromCoord, toCoord) {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const startTime = now.toISOString().slice(0, 16);
  const url = `https://navitime-route-totalnavi.p.rapidapi.com/route_transit?start=${fromCoord.lat},${fromCoord.lng}&goal=${toCoord.lat},${toCoord.lng}&start_time=${startTime}&datum=wgs84`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "x-rapidapi-key": NAVITIME_API_KEY,
      "x-rapidapi-host": "navitime-route-totalnavi.p.rapidapi.com"
    }
  });

  if (!res.ok) {
    throw new Error(`NAVITIME APIエラー（HTTP ${res.status}）`);
  }

  const data = await res.json();
  if (!data.items || data.items.length === 0) {
    return null; // 経路が見つからなかった
  }
  return Math.round(data.items[0].summary.move.time);
}

/* =========================================================
   Google Places Nearby Search で指定地点周辺の駅を取得
   ========================================================= */
/* =========================================================
   🟢 Places API（New）で指定地点周辺の駅を取得
   ========================================================= */

// Place.locationを通常の緯度経度に変換する
function placeLocationToLiteral(location) {
  if (!location) {
    return null;
  }

  // google.maps.LatLngの場合
  if (
    typeof location.lat === "function" &&
    typeof location.lng === "function"
  ) {
    return {
      lat: location.lat(),
      lng: location.lng()
    };
  }

  // { lat: 数値, lng: 数値 } の場合
  if (
    typeof location.lat === "number" &&
    typeof location.lng === "number"
  ) {
    return {
      lat: location.lat,
      lng: location.lng
    };
  }

  return null;
}


// Places APIのエラーを文字列に変換する
function getPlacesErrorMessage(error) {
  console.error("Places API（New）エラー:", error);

  if (!error) {
    return "原因不明のエラーです";
  }

  if (error.message) {
    return error.message;
  }

  if (error.code) {
    return String(error.code);
  }

  return String(error);
}


// Places API（New）で周辺駅を検索する
async function findNearbyStations(centerLat, centerLng, radius) {
  try {
    const {
      Place,
      SearchNearbyRankPreference
    } = await google.maps.importLibrary("places");

    // 検索半径を1mから50kmの範囲にする
    const safeRadius = Math.min(
      Math.max(Number(radius) || 2000, 1),
      50000
    );

    const request = {
      fields: [
        "id",
        "displayName",
        "location",
        "formattedAddress",
        "googleMapsURI"
      ],

      locationRestriction: {
        center: {
          lat: Number(centerLat),
          lng: Number(centerLng)
        },
        radius: safeRadius
      },

      includedPrimaryTypes: [
        "train_station"
      ],

      maxResultCount: 20,

      rankPreference:
        SearchNearbyRankPreference.DISTANCE
    };

    const { places } =
      await Place.searchNearby(request);

    return (places || [])
      .map(place => {
        const location =
          placeLocationToLiteral(place.location);

        if (!location) {
          return null;
        }

        return {
          id: place.id || "",
          name: place.displayName || "名称不明",
          lat: location.lat,
          lng: location.lng,
          address: place.formattedAddress || "",
          googleMapsURI: place.googleMapsURI || ""
        };
      })
      .filter(Boolean);

  } catch (error) {
    throw new Error(
      "周辺の駅検索でエラーが発生しました：" +
      getPlacesErrorMessage(error)
    );
  }
}

/* =========================================================
   中間駅を選出する
   起点駅群の重心付近をPlaces Nearby Searchで検索して候補駅を集め、
   NAVITIMEで各起点駅からの所要時間を評価し、
   「最長所要時間が最小」の駅をミニマックス方式で採用する
   ========================================================= */
async function findMidpointStation(originStations) {
  const centLat = originStations.reduce((a, s) => a + s.lat, 0) / originStations.length;
  const centLng = originStations.reduce((a, s) => a + s.lng, 0) / originStations.length;

  // 起点駅同士の最大距離から検索半径の初期値を決める（2km〜20kmに収める）
  let maxSpanKm = 0;
  for (let i = 0; i < originStations.length; i++) {
    for (let j = i + 1; j < originStations.length; j++) {
      maxSpanKm = Math.max(
        maxSpanKm,
        haversine(originStations[i].lat, originStations[i].lng, originStations[j].lat, originStations[j].lng)
      );
    }
  }
  let searchRadius = Math.min(Math.max((maxSpanKm * 1000) / 2, 2000), 20000);

  const originNames = originStations.map(s => s.name);
  let placesResults = [];

  // 候補が足りない場合は検索半径を広げながら最大3回まで再検索
  for (let attempt = 0; attempt < 3 && placesResults.length < CANDIDATE_COUNT; attempt++) {
    setStatus(`周辺の駅を検索中…（検索半径 約${Math.round(searchRadius / 1000)}km）`);
    placesResults = await findNearbyStations(centLat, centLng, searchRadius);
    searchRadius *= 2;
  }

  // const candidates = placesResults
  //   .filter(p => p.geometry && p.geometry.location)
  //   .map(p => ({
  //     name: p.name,
  //     lat: p.geometry.location.lat(),
  //     lng: p.geometry.location.lng()
  //   }))
  //   .filter(c => !originNames.includes(c.name))
  //   .sort((a, b) =>
  //     haversine(centLat, centLng, a.lat, a.lng) - haversine(centLat, centLng, b.lat, b.lng)
  //   )
  //   .slice(0, CANDIDATE_COUNT);
// 🟢 findNearbyStations()ですでに
// name、lat、lng形式へ変換しているため、そのまま使用する
const candidates = placesResults
  .filter(place =>
    place &&
    place.name &&
    Number.isFinite(place.lat) &&
    Number.isFinite(place.lng)
  )

  // 起点駅と同じ駅は候補から外す
  .filter(place => {
    const candidateName =
      place.name
        .replace(/駅$/u, "")
        .trim();

    return !originNames.some(originName =>
      originName
        .replace(/駅$/u, "")
        .trim() === candidateName
    );
  })

  // 重心に近い順に並べる
  .sort((a, b) =>
    haversine(
      centLat,
      centLng,
      a.lat,
      a.lng
    ) -
    haversine(
      centLat,
      centLng,
      b.lat,
      b.lng
    )
  )

  // 評価する駅数に絞る
  .slice(0, CANDIDATE_COUNT);
  if (candidates.length === 0) {
    throw new Error("中間駅の候補が見つかりませんでした（Places検索でヒットしませんでした）");
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const scored = [];
  const total = candidates.length * originStations.length;
  let done = 0;

  for (const cand of candidates) {
    const times = [];
    for (const origin of originStations) {
      done++;
      setStatus(`${cand.name}駅を評価中…（${done}/${total} リクエスト）`);
      const t = await navitimeTransitTime(origin, cand);
      times.push(t === null ? null : t);
      await sleep(500); // NAVITIME APIのレート制限対策
    }

    const validTimes = times.filter(t => t !== null);
    if (validTimes.length === 0) continue; // どの起点からも経路が見つからなかった候補は除外

    const maxTime = Math.max(...validTimes);
    const avg = validTimes.reduce((a, b) => a + b, 0) / validTimes.length;
    const variance = validTimes.reduce((s, t) => s + (t - avg) ** 2, 0) / validTimes.length;
    scored.push({ ...cand, times, maxTime, avg, variance });
  }

  if (scored.length === 0) {
    throw new Error("NAVITIMEで経路が見つかる候補駅がありませんでした");
  }

  scored.sort((a, b) => a.maxTime - b.maxTime || a.variance - b.variance);
  return scored[0];
}

/* =========================================================
   HotPepper検索（サーバー経由）
   ========================================================= */
async function searchHotPepper(lat, lng, keyword, price, radius) {
  const params = new URLSearchParams({ lat, lng });
  if (keyword) params.set("keyword", keyword);
  if (price) params.set("price", price);
  if (radius) params.set("radius", radius);

  const url = `${HOTPEPPER_API_BASE}/hotpepper?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HotPepper検索エラー（HTTP ${res.status}）`);
  const data = await res.json();
  return (data.results && data.results.shop) || [];
}

/* =========================================================
   Google Places検索（飲食店以外のカテゴリ：カラオケ／ボウリング／
   ショッピングモール／映画館／ゲームセンター）
   ========================================================= */
// function findNearbyPlaces(centerLat, centerLng, radius, searchOptions) {
//   return new Promise((resolve, reject) => {
//     const service = new google.maps.places.PlacesService(map);
//     service.nearbySearch(
//       {
//         location: { lat: centerLat, lng: centerLng },
//         radius: radius,
//         ...searchOptions
//       },
//       (results, status) => {
//         if (status === google.maps.places.PlacesServiceStatus.OK && results) {
//           resolve(results);
//         } else if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
//           resolve([]);
//         } else {
//           reject(new Error(`周辺施設の検索でエラーが発生しました（${status}）`));
//         }
//       }
//     );
//   });
// }

// // Google PlacesのPlaceResultを、既存の描画・お気に入り機能が期待する
// // HotPepper形式（shop.genre.name / shop.photo.pc.m など）に変換する
// function normalizeGooglePlace(place, categoryLabel) {
//   const loc = place.geometry && place.geometry.location;
//   const photoUrl = (place.photos && place.photos.length > 0)
//     ? place.photos[0].getUrl({ maxWidth: 200, maxHeight: 200 })
//     : "https://placehold.co/100x100?text=No+Image";

//   return {
//     id: place.place_id,
//     name: place.name,
//     lat: loc ? loc.lat() : null,
//     lng: loc ? loc.lng() : null,
//     genre: { name: categoryLabel },
//     photo: { pc: { m: photoUrl } },
//     address: place.vicinity || "",
//     mobile_access: place.vicinity || "",
//     close: "",
//     open: (place.opening_hours && place.opening_hours.open_now) ? "営業中" : "",
//     urls: {
//       pc: place.place_id
//         ? `https://www.google.com/maps/place/?q=place_id:${place.place_id}`
//         : "#"
//     }
//   };
// }

// async function searchLeisureFacilities(lat, lng, radius, category) {
//   const config = LEISURE_CATEGORY_CONFIG[category] || { keyword: category };
//   const places = await findNearbyPlaces(lat, lng, radius, config);
//   return places.map(p => normalizeGooglePlace(p, category));
// }
/* =========================================================
   🟢 Places API（New）によるレジャー施設検索
   ========================================================= */


/*
 * 場所タイプで周辺検索する
 *
 * 対象:
 * ・ボウリング
 * ・ショッピングモール
 * ・映画館
 */
async function findNearbyPlacesByType(
  centerLat,
  centerLng,
  radius,
  placeType
) {
  try {
    const {
      Place,
      SearchNearbyRankPreference
    } = await google.maps.importLibrary("places");

    const safeRadius = Math.min(
      Math.max(Number(radius) || 1000, 1),
      50000
    );

    const request = {
      fields: [
        "id",
        "displayName",
        "location",
        "formattedAddress",
        "googleMapsURI",
        "photos"
      ],

      locationRestriction: {
        center: {
          lat: Number(centerLat),
          lng: Number(centerLng)
        },
        radius: safeRadius
      },

      includedPrimaryTypes: [
        placeType
      ],

      maxResultCount: 20,

      rankPreference:
        SearchNearbyRankPreference.POPULARITY
    };

    const { places } =
      await Place.searchNearby(request);

    return places || [];

  } catch (error) {
    throw new Error(
      "周辺施設の検索でエラーが発生しました：" +
      getPlacesErrorMessage(error)
    );
  }
}


/*
 * キーワードで施設を検索する
 *
 * 対象:
 * ・カラオケ
 * ・ゲームセンター
 */
async function findNearbyPlacesByText(
  centerLat,
  centerLng,
  radius,
  keyword
) {
  try {
    const {
      Place
    } = await google.maps.importLibrary("places");

    const center = {
      lat: Number(centerLat),
      lng: Number(centerLng)
    };

    const safeRadius = Math.min(
      Math.max(Number(radius) || 1000, 1),
      50000
    );

    const request = {
      textQuery: keyword,

      fields: [
        "id",
        "displayName",
        "location",
        "formattedAddress",
        "googleMapsURI",
        "photos"
      ],

      // 指定地点の周辺を優先して検索する
      locationBias: {
        center: center,
        radius: safeRadius
      },

      maxResultCount: 20,
      language: "ja",
      region: "jp"
    };

    const { places } =
      await Place.searchByText(request);

    /*
     * locationBiasは「周辺を優先する」設定なので、
     * 指定半径より外側の施設を手動で除外する
     */
    return (places || []).filter(place => {
      const location =
        placeLocationToLiteral(place.location);

      if (!location) {
        return false;
      }

      const distanceKm = haversine(
        center.lat,
        center.lng,
        location.lat,
        location.lng
      );

      return distanceKm <= safeRadius / 1000;
    });

  } catch (error) {
    throw new Error(
      "施設のキーワード検索でエラーが発生しました：" +
      getPlacesErrorMessage(error)
    );
  }
}


/*
 * カテゴリ設定に応じて、
 * Nearby SearchとText Searchを切り替える
 */
async function findNearbyPlaces(
  centerLat,
  centerLng,
  radius,
  searchConfig
) {
  if (!searchConfig) {
    throw new Error(
      "施設検索の設定がありません"
    );
  }

  // 場所タイプによる周辺検索
  if (
    searchConfig.mode === "nearby" &&
    searchConfig.type
  ) {
    return await findNearbyPlacesByType(
      centerLat,
      centerLng,
      radius,
      searchConfig.type
    );
  }

  // キーワードによるテキスト検索
  if (
    searchConfig.mode === "text" &&
    searchConfig.keyword
  ) {
    return await findNearbyPlacesByText(
      centerLat,
      centerLng,
      radius,
      searchConfig.keyword
    );
  }

  throw new Error(
    "レジャーカテゴリの設定が正しくありません"
  );
}


/*
 * Places API（New）の検索結果を、
 * HotPepper形式に変換する
 */
function normalizeGooglePlace(
  place,
  categoryLabel
) {
  const location =
    placeLocationToLiteral(place.location);

  if (!location) {
    return null;
  }

  // 写真がないときの代替画像
  let photoUrl =
    "https://placehold.co/200x200?text=No+Image";

  /*
   * Legacy版:
   * place.photos[0].getUrl()
   *
   * New版:
   * place.photos[0].getURI()
   */
  if (
    Array.isArray(place.photos) &&
    place.photos.length > 0
  ) {
    try {
      photoUrl =
        place.photos[0].getURI({
          maxWidth: 400,
          maxHeight: 400
        });
    } catch (error) {
      console.warn(
        "写真URLの取得に失敗しました:",
        error
      );
    }
  }

  const googleMapsUrl =
    place.googleMapsURI ||
    (
      place.id
        ? `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(place.id)}&query=${location.lat},${location.lng}`
        : `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`
    );

  return {
    id:
      place.id ||
      `${categoryLabel}-${location.lat}-${location.lng}`,

    name:
      place.displayName ||
      "名称不明",

    lat: location.lat,
    lng: location.lng,

    genre: {
      name: categoryLabel
    },

    photo: {
      pc: {
        m: photoUrl
      }
    },

    address:
      place.formattedAddress || "",

    mobile_access:
      place.formattedAddress || "",

    close: "",

    open: "",

    urls: {
      pc: googleMapsUrl
    }
  };
}


/*
 * レジャー施設検索の入口
 */
async function searchLeisureFacilities(
  lat,
  lng,
  radius,
  category
) {
  const config =
    LEISURE_CATEGORY_CONFIG[category] || {
      mode: "text",
      keyword: category
    };

  const places = await findNearbyPlaces(
    lat,
    lng,
    radius,
    config
  );

  return places
    .map(place =>
      normalizeGooglePlace(
        place,
        category
      )
    )
    .filter(Boolean);
}
/* =========================================================
   店舗一覧の描画（ジャンル絞り込み対応）
   ========================================================= */
function updateDisplay() {
  clearShopMarkers();

  const genreFilter = document.getElementById("genreFilter");
  const selectedGenre = genreFilter ? genreFilter.value : "すべて";

  const filteredShops = allShops.filter(shop => {
    if (selectedGenre === "すべて") return true;
    return shop.genre && shop.genre.name && shop.genre.name.includes(selectedGenre);
  });

  const matchCountEl = document.getElementById("matchCount");
  const ul = document.getElementById("resultsList");
  ul.innerHTML = "";

  if (filteredShops.length === 0) {
    matchCountEl.textContent = "該当する店舗が見つかりませんでした。";
    return;
  }
  matchCountEl.textContent = `検索結果：${filteredShops.length}件`;

  const currentBookmarks = JSON.parse(localStorage.getItem("bookmarks")) || [];

  filteredShops.forEach(shop => {
    const marker = new google.maps.Marker({
      map,
      position: { lat: Number(shop.lat), lng: Number(shop.lng) },
      title: shop.name
    });
    shopMarkers.push(marker);

    const info = new google.maps.InfoWindow({
      content: `
        <strong>${shop.name}</strong><br>
        住所：${shop.address}<br>
        営業時間：${shop.open || ""}<br>
        <a href="${shop.urls.pc}" target="_blank">店舗ページ</a>
      `
    });
    marker.addListener("click", () => {
      if (currentInfoWindow) currentInfoWindow.close();
      currentInfoWindow = info;
      info.open(map, marker);
    });

    const imgUrl = shop.photo?.pc?.m || 'https://placehold.co/100x100?text=No+Image';
    const access = shop.mobile_access || shop.station_name || '最寄り駅情報なし';
    const close = shop.close || 'データなし';
    const isBookmarked = currentBookmarks.some(b => b.id === shop.id);

    const li = document.createElement("li");
    li.innerHTML = `
      <img src="${imgUrl}" class="shop-img">
      <div class="shop-info">
        <div class="shop-genre">${shop.genre.name}</div>
        <div class="shop-name">${shop.name}</div>
        <div class="shop-sub">📍 ${access}</div>
        <div class="shop-sub">📅 定休日: ${close}</div>
        <button class="bookmark-btn" style="${isBookmarked ? 'background:#ff8e42;color:#fff;' : ''}">
          ${isBookmarked ? '🧡 お気に入り登録済み' : '⭐ お気に入り登録'}
        </button>
      </div>
    `;

    li.addEventListener("click", () => {
      map.panTo(marker.getPosition());
      map.setZoom(16);
      google.maps.event.trigger(marker, "click");
    });

    const btn = li.querySelector(".bookmark-btn");
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      let bookmarks = JSON.parse(localStorage.getItem("bookmarks")) || [];
      const isExisting = bookmarks.some(b => b.id === shop.id);
      if (isExisting) {
        bookmarks = bookmarks.filter(b => b.id !== shop.id);
        localStorage.setItem("bookmarks", JSON.stringify(bookmarks));
        btn.textContent = "⭐ お気に入り登録";
        btn.style.background = "#fff";
        btn.style.color = "#ff8e42";
        alert(`「${shop.name}」をお気に入りから削除しました。`);
      } else {
        bookmarks.push({
          id: shop.id,
          name: shop.name,
          genre: { name: shop.genre.name },
          photo: { pc: { m: imgUrl } },
          mobile_access: access,
          close: close
        });
        localStorage.setItem("bookmarks", JSON.stringify(bookmarks));
        btn.textContent = "🧡 お気に入り登録済み";
        btn.style.background = "#ff8e42";
        btn.style.color = "#fff";
        alert(`「${shop.name}」をお気に入りに追加しました！`);
      }
    });

    ul.appendChild(li);
  });
}

/* =========================================================
   お気に入り一覧の表示
   ========================================================= */
function showBookmarkList() {
  clearShopMarkers();
  const ul = document.getElementById("resultsList");
  ul.innerHTML = "";
  const matchCountEl = document.getElementById("matchCount");
  const savedBookmarks = JSON.parse(localStorage.getItem("bookmarks")) || [];

  matchCountEl.textContent = savedBookmarks.length ? `お気に入り：${savedBookmarks.length}件` : "";

  if (savedBookmarks.length === 0) {
    ul.innerHTML = "<li style='cursor:default; justify-content:center; color:#999;'>お気に入りは登録されていません</li>";
    return;
  }

  savedBookmarks.forEach(shop => {
    const li = document.createElement("li");
    li.innerHTML = `
      <img src="${shop.photo.pc.m}" class="shop-img">
      <div class="shop-info">
        <div class="shop-genre">${shop.genre.name}</div>
        <div class="shop-name">${shop.name}</div>
        <div class="shop-sub">📍 ${shop.access ?? shop.mobile_access ?? ''}</div>
        <div class="shop-sub">📅 定休日: ${shop.close}</div>
        <button class="bookmark-btn" style="background:#ff8e42; color:#fff;">🧡 お気に入り登録済み</button>
      </div>
    `;
    const btn = li.querySelector(".bookmark-btn");
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      let bookmarks = JSON.parse(localStorage.getItem("bookmarks")) || [];
      bookmarks = bookmarks.filter(b => b.id !== shop.id);
      localStorage.setItem("bookmarks", JSON.stringify(bookmarks));
      alert(`「${shop.name}」をお気に入りから削除しました。`);
      showBookmarkList();
    });
    ul.appendChild(li);
  });
}

/* =========================================================
   メイン処理
   ========================================================= */
async function runSearch() {
  if (!NAVITIME_API_KEY) {
    setStatus("⚠ NAVITIMEのAPIキーが未設定です。result.js先頭の NAVITIME_API_KEY に値を入力してください。");
    document.getElementById("matchCount").textContent = "";
    return;
  }

  clearAllMarkers();
  const bounds = new google.maps.LatLngBounds();

  // --- ① トップページで入力された駅を読み込み ---
  const savedStations = JSON.parse(localStorage.getItem("stations") || "[]");
  const keyword = localStorage.getItem("keyword") || "";
  const price = localStorage.getItem("price") || "";
  const radius = localStorage.getItem("radius") || "";

  const inputNames = savedStations.map(s => (s || "").trim()).filter(s => s);
  if (inputNames.length < 2) {
    setStatus("駅を2つ以上入力してください。トップページからやり直してください。");
    return;
  }

  // --- ② Geocodingで各起点駅の緯度経度を取得 ---
  setStatus("入力された駅の位置情報を取得中…");
  const originStations = [];
  const geocodeErrors = [];
  for (const name of inputNames) {
    try {
      const loc = await geocodeStation(name);
      originStations.push(loc);
      const marker = new google.maps.Marker({
        map,
        position: { lat: loc.lat, lng: loc.lng },
        label: "駅",
        title: loc.name
      });
      originMarkers.push(marker);
      bounds.extend({ lat: loc.lat, lng: loc.lng });
    } catch (e) {
      geocodeErrors.push(e.message);
    }
  }

  if (originStations.length < 2) {
    setStatus(`位置情報を取得できた駅が2つ未満です。${geocodeErrors.join(" / ")}`);
    return;
  }

  // --- ③ NAVITIMEで中間駅を選出 ---
  let midpoint;
  try {
    midpoint = await findMidpointStation(originStations);
  } catch (e) {
    setStatus(`中間駅の計算に失敗しました：${e.message}`);
    return;
  }

  midpointMarker = new google.maps.Marker({
    map,
    position: { lat: midpoint.lat, lng: midpoint.lng },
    label: "★",
    title: `${midpoint.name}駅（中間駅）`
  });
  bounds.extend({ lat: midpoint.lat, lng: midpoint.lng });
  map.fitBounds(bounds, 60);

  setStatus(
    `中間駅：${midpoint.name}駅（最長 ${midpoint.maxTime}分 ／ 平均 ${Math.round(midpoint.avg)}分）` +
    (geocodeErrors.length ? ` ※一部の駅は位置情報を取得できませんでした：${geocodeErrors.join(" / ")}` : "")
  );

  // --- ④ 中間駅周辺の施設を検索（カテゴリに応じて検索先を切り替え） ---
  const category = localStorage.getItem("category") || "飲食店";
  const searchRadiusMeters = Number(radius) || 1000;

  try {
    if (category === "飲食店") {
      // 飲食店はHotPepper（サーバー経由）で検索
      allShops = await searchHotPepper(midpoint.lat, midpoint.lng, keyword, price, radius);
    } else {
      // 飲食店以外（カラオケ／ボウリング／ショッピングモール／映画館／ゲームセンター）は
      // HotPepperが飲食店専用APIのため対応できない。Google Places（Nearby Search）で検索する。
      allShops = await searchLeisureFacilities(midpoint.lat, midpoint.lng, searchRadiusMeters, category);
    }
  } catch (e) {
    document.getElementById("matchCount").textContent = `店舗検索に失敗しました：${e.message}`;
    return;
  }

  updateDisplay();
}

/* =========================================================
   検索結果 / お気に入り 切り替えボタン
   ========================================================= */
document.getElementById("showBookmarksBtn").addEventListener("click", () => {
  showBookmarkList();
  document.getElementById("showBookmarksBtn").style.background = "#ddd";
  document.getElementById("showResultsBtn").style.background = "#fff";
});

document.getElementById("showResultsBtn").addEventListener("click", () => {
  updateDisplay(); // 既に取得済みのallShopsから再描画（APIは再呼び出ししない）
  document.getElementById("showResultsBtn").style.background = "#ddd";
  document.getElementById("showBookmarksBtn").style.background = "#fff";
});

/* =========================================================
   ジャンル絞り込み
   ========================================================= */
const genreFilterEl = document.getElementById("genreFilter");
if (genreFilterEl) {
  genreFilterEl.addEventListener("change", updateDisplay);
}

/* =========================================================
   ページ共有ボタン
   ========================================================= */
const shareButton = document.getElementById('webShareButton');
if (shareButton) {
  shareButton.addEventListener('click', async () => {
    const descriptionMeta = document.querySelector("meta[name='description']");
    const description = descriptionMeta ? descriptionMeta.getAttribute("content") : '';
    try {
      await navigator.share({
        title: document.title,
        text: description,
        url: window.location.href
      });
    } catch (error) {
      console.error('シェア失敗', error);
    }
  });
}