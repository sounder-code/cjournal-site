const state = {
  tab: "monster",
  query: "",
  monsters: [],
  regions: [],
  items: [],
};

const $summary = document.getElementById("summary");
const $listRoot = document.getElementById("listRoot");
const $search = document.getElementById("searchInput");

function card(title, meta, chips = []) {
  const chipHtml = chips
    .slice(0, 16)
    .map((x) => `<span class="chip">${x}</span>`)
    .join("");
  return `
    <article class="card">
      <h3 class="title">${title}</h3>
      <div class="meta">${meta}</div>
      ${chipHtml ? `<div class="chips">${chipHtml}</div>` : ""}
    </article>
  `;
}

function render() {
  const q = state.query.trim();
  const match = (text) => text.toLowerCase().includes(q.toLowerCase());
  let html = "";
  let total = 0;

  if (state.tab === "monster") {
    const list = state.monsters.filter(
      (m) =>
        !q ||
        match(m.monsterName || "") ||
        (m.regions || []).some(match) ||
        (m.dropItemNames || []).some(match)
    );
    total = list.length;
    html = list
      .map((m) =>
        card(
          `${m.monsterName} (Lv.${m.level ?? "-"})`,
          `출몰지역 ${m.regions?.length || 0}개 · 드랍아이템 ${m.dropItemNames?.length || 0}개`,
          [...(m.regions || []).slice(0, 8), ...(m.dropItemNames || []).slice(0, 8)]
        )
      )
      .join("");
  } else if (state.tab === "region") {
    const list = state.regions.filter((r) => !q || match(r.regionName) || (r.monsterNames || []).some(match));
    total = list.length;
    html = list.map((r) => card(r.regionName, `몬스터 ${r.monsterCount}종`, r.monsterNames || [])).join("");
  } else {
    const list = state.items.filter((i) => !q || match(i.itemName) || (i.monsterNames || []).some(match));
    total = list.length;
    html = list.map((i) => card(i.itemName, `드랍 몬스터 ${i.monsterCount}종`, i.monsterNames || [])).join("");
  }

  const tabName = state.tab === "monster" ? "몬스터" : state.tab === "region" ? "지역" : "아이템";
  $summary.textContent = `${tabName} ${total}건`;
  $listRoot.innerHTML = html || `<article class="card"><h3 class="title">검색 결과 없음</h3><div class="meta">조건을 변경해보세요.</div></article>`;
}

async function loadDatasets() {
  const [monsters, regions, items] = await Promise.all([
    fetch("/data/linclassic/monsters.json").then((r) => r.json()),
    fetch("/data/linclassic/regions.json").then((r) => r.json()),
    fetch("/data/linclassic/items.json").then((r) => r.json()),
  ]);
  state.monsters = monsters;
  state.regions = regions;
  state.items = items;
}

function bindEvents() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((x) => x.classList.remove("is-active"));
      btn.classList.add("is-active");
      state.tab = btn.dataset.tab;
      render();
    });
  });

  $search.addEventListener("input", (e) => {
    state.query = e.target.value || "";
    render();
  });
}

async function init() {
  bindEvents();
  $summary.textContent = "사전 생성된 데이터 불러오는 중...";
  try {
    await loadDatasets();
    render();
  } catch (err) {
    console.error(err);
    $summary.textContent = "정적 데이터 로드 실패";
    $listRoot.innerHTML = `<article class="card"><h3 class="title">API 로드 실패</h3><div class="meta">잠시 후 다시 시도해 주세요.</div></article>`;
  }
}

init();
