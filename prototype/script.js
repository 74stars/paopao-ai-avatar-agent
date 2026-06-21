const state = {
  profile: JSON.parse(localStorage.getItem("paopaoProfile") || "null"),
  mood: localStorage.getItem("paopaoMood") || "扩张",
  entries: JSON.parse(localStorage.getItem("paopaoEntries") || "null") || [
    {
      type: "文字",
      raw: "今天在车上突然想到，人好像不是靠目标活着，而是靠某种隐秘的期待撑着。",
      polished: "今天在车上突然冒出一个念头：人也许并不是靠目标活着，而是靠某种隐秘的期待，一点点撑过日常。目标是写在纸上的，期待却藏在身体里。",
      time: "09:42",
    },
    {
      type: "画面描述",
      raw: "玻璃窗上有雨，路灯像被水泡软了。",
      polished: "雨停在玻璃上，路灯被水光泡软，城市像暂时放低了声音。",
      time: "17:18",
    },
  ],
  schedule: JSON.parse(localStorage.getItem("paopaoSchedule") || "null") || [
    { time: "09:30", text: "写作业 / 深度学习" },
    { time: "14:00", text: "整理灵感素材" },
    { time: "21:30", text: "泡泡每日成册" },
  ],
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

function saveState() {
  localStorage.setItem("paopaoEntries", JSON.stringify(state.entries));
  localStorage.setItem("paopaoSchedule", JSON.stringify(state.schedule));
  localStorage.setItem("paopaoMood", state.mood);
  localStorage.setItem("paopaoProfile", JSON.stringify(state.profile));
}

function currentTime() {
  return new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function polish(raw, type) {
  const clean = raw.trim().replace(/\s+/g, " ");
  const starts = {
    text: "我替你把这枚念头轻轻擦亮：",
    voice: "这段语音里最亮的部分像是：",
    image: "这幅画面留下来的感觉是：",
    link: "这个链接真正触动你的地方也许是：",
  };
  const tail = clean.endsWith("。") || clean.endsWith("！") || clean.endsWith("？") ? clean : `${clean}。`;
  return `${starts[type] || starts.text}${tail} 它先不用被解释成结论，只要被好好留下。`;
}

function renderEntries() {
  const strip = $("#entriesStrip");
  strip.innerHTML = state.entries
    .slice()
    .reverse()
    .map(
      (entry) => `
      <article class="entry-card">
        <small>${entry.time} · ${entry.type}</small>
        <p>${entry.polished}</p>
      </article>
    `,
    )
    .join("");
}

function renderDiary() {
  const profileLine = state.profile?.kind ? `泡泡今天以「${state.profile.kind}」作为进化方向理解你。` : "泡泡今天仍在建立你的数字分身。";
  const body = state.entries
    .map((entry) => `- ${entry.polished}\n  原始：${entry.raw}`)
    .join("\n\n");
  $("#diaryMood").textContent = `情绪：${state.mood}`;
  $("#diaryText").textContent = `${profileLine}

今天的记录不是为了沉溺情绪，而是为了看见你的欲望、判断、行动和长期成长轨迹。

${body}

今日关键词：野心、认知、行动、世界经验。
泡泡给你的晚间句子：把想法变成资产，把欲望变成计划，把计划变成世界里的结果。`;
}

function renderSchedule() {
  $("#scheduleList").innerHTML = state.schedule
    .map(
      (item) => `
      <div class="schedule-item">
        <strong>${item.time}</strong>
        <span>${item.text}</span>
      </div>
    `,
    )
    .join("");
}

function setReply(title, text) {
  $("#replyTitle").textContent = title;
  $("#replyText").textContent = text;
}

function updateCardFromDiary() {
  const latest = state.entries[state.entries.length - 1];
  const quote = latest?.polished || "人也许并不是靠目标活着，而是靠某种隐秘的期待。";
  $("#cardQuote").textContent = quote;
  $("#cardInput").value = quote;
}

$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    $$(".tab").forEach((item) => item.classList.remove("active"));
    $$(".view").forEach((view) => view.classList.remove("active"));
    tab.classList.add("active");
    $(`#${tab.dataset.view}View`).classList.add("active");
    if (tab.dataset.view === "diary") renderDiary();
    if (tab.dataset.view === "cards") updateCardFromDiary();
  });
});

$("#saveEntry").addEventListener("click", () => {
  const raw = $("#rawInput").value.trim();
  if (!raw) {
    setReply("我在这里。", "哪怕只有半句话也可以，先把它放下来。");
    return;
  }
  const type = $("#inputType");
  const entry = {
    type: type.options[type.selectedIndex].text,
    raw,
    polished: polish(raw, type.value),
    time: currentTime(),
  };
  state.entries.push(entry);
  $("#rawInput").value = "";
  saveState();
  renderEntries();
  renderDiary();
  updateCardFromDiary();
  setReply("我收好了。", "原始表达已经留下，我也给它生成了一版更清澈的文字。今晚它会进入今日日记。");
});

$("#talkMode").addEventListener("click", () => {
  const raw = $("#rawInput").value.trim();
  setReply(
    "我们可以慢慢聊。",
    raw
      ? `我听见的是：「${raw}」这里面像有一个还没完全展开的核心。你想让我陪你继续追问，还是先替你收进今日？`
      : "你可以先随便说一句，不必组织好。泡泡会从你的语气里慢慢靠近真正重要的东西。",
  );
});

$$(".mood-row button").forEach((button) => {
  button.addEventListener("click", () => {
    state.mood = button.dataset.mood;
    saveState();
    const messages = {
      行动: ["进入行动档。", "我会帮你把目标拆成下一步，把注意力放回最能产生复利的事情。"],
      扩张: ["你的现实半径正在扩大。", "今天记录的不只是感受，还有资源、机会、人、钱、地点和判断。"],
      深思: ["把思考升级成认知资产。", "我会帮你提炼问题、模型和可复用的判断，而不是让思考停在原地。"],
      显化: ["把欲望写成计划。", "你可以直说你想要什么，我会帮你把它转成路径、节奏和提醒。"],
    };
    setReply(messages[state.mood][0], messages[state.mood][1]);
    renderDiary();
  });
});

$("#refreshDiary").addEventListener("click", () => {
  renderDiary();
  $("#heroTitle").textContent = "今日已经成册。";
  $("#heroCopy").textContent = "泡泡保留了原始碎片，也把它们整理成一页可以回看的生活。";
});

$("#renderCard").addEventListener("click", () => {
  const text = $("#cardInput").value.trim();
  $("#cardQuote").textContent = text || "今天也有一些微小的光，被我好好留下了。";
});

$("#downloadCard").addEventListener("click", () => {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#eff9ff");
  gradient.addColorStop(0.48, "#bdeef4");
  gradient.addColorStop(1, "#fff3dd");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(255,255,255,.62)";
  ctx.fillRect(70, 80, 940, 1190);
  ctx.fillStyle = "#3179ba";
  ctx.font = "700 34px Microsoft YaHei, sans-serif";
  ctx.fillText("泡泡摘录", 130, 170);
  ctx.fillStyle = "#173d5f";
  ctx.font = "700 64px Microsoft YaHei, sans-serif";
  wrapCanvasText(ctx, $("#cardQuote").textContent, 130, 370, 820, 92);
  ctx.fillStyle = "#3179ba";
  ctx.font = "700 32px Microsoft YaHei, sans-serif";
  ctx.fillText("2026.06.21", 130, 1170);
  const link = document.createElement("a");
  link.download = "paopao-card.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
});

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight) {
  const chars = [...text];
  let line = "";
  for (const char of chars) {
    const testLine = line + char;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      line = char;
      y += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, y);
}

$("#addSchedule").addEventListener("click", () => {
  const value = $("#scheduleInput").value.trim();
  if (!value) return;
  const match = value.match(/^(\d{1,2}[:：]\d{2})\s*(.*)$/);
  state.schedule.push({
    time: match ? match[1].replace("：", ":") : currentTime(),
    text: match ? match[2] || "新的安排" : value,
  });
  $("#scheduleInput").value = "";
  saveState();
  renderSchedule();
  $("#nudgeText").textContent = "我已经把新的安排放进今天。等你偏离太久时，我会用你喜欢的语气提醒你回来。";
});

$("#goalInput").addEventListener("input", (event) => {
  $("#nudgeText").textContent = `我记住了：${event.target.value}。今天不用完成全部，只要让它往前一点点。`;
});

function selectProfile(kind) {
  state.profile = {
    kind,
    text: $("#profileText").value.trim(),
  };
  $$(".choice-grid button").forEach((button) => {
    button.classList.toggle("selected", button.dataset.profile === kind);
  });
}

$$(".choice-grid button").forEach((button) => {
  button.addEventListener("click", () => selectProfile(button.dataset.profile));
});

$("#finishOnboard").addEventListener("click", () => {
  if (!state.profile) selectProfile("边用边认识");
  state.profile.text = $("#profileText").value.trim();
  saveState();
  $("#onboarding").classList.add("hidden");
  if (state.profile.kind) {
    $("#heroTitle").textContent = "我会记录全面的你，并推动你成为更大的自己。";
    $("#heroCopy").textContent = "欲望、计划、地点、人物、日程、阅读、机会和行动，都会进入你的长期记忆系统。";
  }
});

$("#openProfile").addEventListener("click", () => {
  $("#onboarding").classList.remove("hidden");
});

if (new URLSearchParams(location.search).get("demo") === "1" && !state.profile) {
  state.profile = { kind: "七年跃迁", text: "我要在 23-30 岁完成认知、财富、领导力、作品和世界经验的全面跃迁。" };
  saveState();
}

if (state.profile) {
  $("#onboarding").classList.add("hidden");
}

renderEntries();
renderDiary();
renderSchedule();
updateCardFromDiary();
