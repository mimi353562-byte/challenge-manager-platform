const navConfig = {
  participant: [
    { id: "home", label: "홈", title: "참가자 홈", subtitle: "내 진행 상태와 추천 챌린지를 확인하세요." },
    { id: "challenges", label: "챌린지 탐색", title: "챌린지 탐색", subtitle: "챌린지 상세, 규칙, 상금 구조를 비교하고 참여하세요." },
    { id: "my", label: "내 챌린지", title: "내 챌린지", subtitle: "제출, 반려, 공지, 이의제기까지 한 곳에서 관리합니다." },
    { id: "ranking", label: "랭킹", title: "랭킹", subtitle: "챌린지별 순위와 산정 기준을 확인하세요." },
    { id: "mypage", label: "마이페이지", title: "마이페이지", subtitle: "참여 기록, 예상 보상, 공지와 이의제기 현황을 확인하세요." }
  ],
  organizer: [
    { id: "org-home", label: "대시보드", title: "운영자 대시보드", subtitle: "모집, 검수, 공지, 정산 이슈를 한 번에 확인하세요." },
    { id: "create", label: "챌린지 개설", title: "챌린지 개설", subtitle: "구조화된 규칙으로 챌린지를 생성하세요." },
    { id: "review", label: "검수 큐", title: "검수 큐", subtitle: "제출물을 승인, 반려, 재제출 요청 상태로 관리하세요." },
    { id: "notices", label: "공지 관리", title: "공지 관리", subtitle: "참가자 공지와 운영 알림을 등록하고 수정합니다." },
    { id: "settlement", label: "정산", title: "정산 관리", subtitle: "성공자 확정 후 정산 계산 결과와 지급 상태를 확인하세요." }
  ],
  admin: [
    { id: "admin-home", label: "관리자 홈", title: "관리자 모니터링", subtitle: "운영자 승인, 분쟁, 정산 승인 대기 상태를 확인하세요." },
    { id: "approvals", label: "정산 승인", title: "정산 승인", subtitle: "운영자 확정 이후 관리자 승인과 지급 상태를 관리합니다." },
    { id: "disputes", label: "분쟁 / 이의제기", title: "분쟁 / 이의제기", subtitle: "반려 및 결과 이의제기를 확인하고 답변합니다." }
  ]
};

const statusClassMap = {
  recruiting: "blue",
  in_progress: "orange",
  review: "amber",
  completed: "green",
  draft: "gray",
  joined: "blue",
  submitted: "blue",
  approved: "green",
  rejected: "red",
  resubmit: "amber",
  preview: "gray",
  confirmed: "blue",
  admin_approved: "green",
  paid: "green",
  hold: "amber",
  pending: "amber",
  cancelled: "gray",
  refunded: "red",
  open: "red",
  answered: "blue",
  closed: "green"
};

const statusLabelMap = {
  recruiting: "모집중",
  in_progress: "진행중",
  review: "검수중",
  completed: "종료",
  draft: "초안",
  joined: "참가확정",
  submitted: "제출완료",
  approved: "승인",
  rejected: "반려",
  resubmit: "재제출요청",
  preview: "정산대기",
  confirmed: "운영자확정",
  admin_approved: "관리자승인",
  paid: "지급완료",
  hold: "보류",
  pending: "결제대기",
  cancelled: "결제취소",
  refunded: "환불완료",
  open: "미답변",
  answered: "답변완료",
  closed: "종결"
};

const state = {
  currentRole: "participant",
  currentView: "home",
  selectedChallengeId: null,
  flashMessage: "",
  sessionToken: localStorage.getItem("challenge-manager-session-token") || "",
  currentUser: null,
  draftChallenge: {
    title: "",
    platform: "blog",
    fee: 10000,
    maxParticipants: 20,
    requiredSubmissions: 4,
    settlementType: "equal",
    topN: 3,
    description: "",
    imageRequired: true
  },
  data: {
    challenges: [],
    appeals: [],
    auditLogs: []
  }
};

const viewEl = document.getElementById("view");
const flashEl = document.getElementById("flash");
const pageTitleEl = document.getElementById("pageTitle");
const pageSubtitleEl = document.getElementById("pageSubtitle");

document.getElementById("resetButton").addEventListener("click", async () => {
  window.location.reload();
});

async function bootstrap() {
  if (state.sessionToken) {
    try {
      const me = await api("/api/auth/me");
      state.currentUser = me.user;
      state.currentRole = me.user.role;
      await refreshData();
    } catch {
      clearSession();
    }
  }
  renderApp();
}

async function refreshData() {
  state.data = await api("/api/bootstrap");
  state.currentUser = state.data.currentUser;
  state.currentRole = state.currentUser.role;
  if (!state.selectedChallengeId && state.data.challenges.length) {
    state.selectedChallengeId = state.data.challenges[0].id;
  }
}

function renderApp() {
  if (!state.currentUser) {
    renderLoggedOutShell();
  } else {
    renderRoleSwitch();
    renderNav();
    renderView();
  }
  consumeFlash();
}

function renderRoleSwitch() {
  const el = document.getElementById("roleSwitch");
  el.innerHTML = `
    <button class="active">${roleLabel(state.currentRole)}</button>
    <button id="logoutButton">로그아웃</button>
  `;
  el.querySelector("#logoutButton").addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {}
    clearSession();
    renderApp();
  });
}

function renderNav() {
  const nav = document.getElementById("nav");
  nav.innerHTML = "";
  navConfig[state.currentRole].forEach((item) => {
    const btn = document.createElement("button");
    btn.className = state.currentView === item.id ? "active" : "";
    btn.textContent = item.label;
    btn.addEventListener("click", () => {
      state.currentView = item.id;
      renderApp();
    });
    nav.appendChild(btn);
  });
}

function renderView() {
  const virtualViews = {
    "challenge-detail": { title: "챌린지 상세", subtitle: "참가 전 규칙, 공지, 상금 구조를 확인하세요." },
    "submission-compose": { title: "인증 제출", subtitle: "모바일 기준으로 빠르게 제출하는 실사용 흐름입니다." }
  };

  const current =
    navConfig[state.currentRole].find((item) => item.id === state.currentView) ||
    virtualViews[state.currentView] ||
    navConfig[state.currentRole][0];

  pageTitleEl.textContent = current.title;
  pageSubtitleEl.textContent = current.subtitle;

  const renderers = {
    home: renderParticipantHome,
    challenges: renderChallengeExplore,
    my: renderMyChallenges,
    ranking: renderRanking,
    mypage: renderMyPage,
    "org-home": renderOrganizerHome,
    create: renderCreateChallenge,
    review: renderReviewQueue,
    notices: renderNoticeManager,
    settlement: renderSettlement,
    "admin-home": renderAdminHome,
    approvals: renderAdminApprovals,
    disputes: renderDisputes,
    "challenge-detail": renderChallengeDetail,
    "submission-compose": () => openSubmissionComposer(state.selectedChallengeId, true)
  };

  viewEl.innerHTML = "";
  renderers[state.currentView]();
}

function renderLoggedOutShell() {
  document.getElementById("nav").innerHTML = "";
  document.getElementById("roleSwitch").innerHTML = `
    <button class="active">로그인 필요</button>
  `;
  pageTitleEl.textContent = "로그인";
  pageSubtitleEl.textContent = "로그인하거나 새 계정을 만들어 플랫폼을 사용하세요.";
  viewEl.innerHTML = `
    <section class="split">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Challenge Manager 로그인</h2>
            <p class="muted">실제 권한 기준으로 참가자, 운영자, 관리자 화면이 분리됩니다.</p>
          </div>
        </div>
        <section class="grid cols-2">
          <form id="loginForm" class="card">
            <h3>로그인</h3>
            <div class="field">
              <label for="loginEmail">이메일</label>
              <input id="loginEmail" type="email" placeholder="participant@example.com" required>
            </div>
            <div class="field">
              <label for="loginPassword">비밀번호</label>
              <input id="loginPassword" type="password" placeholder="demo1234" required>
            </div>
            <div class="action-row">
              <button class="primary-btn" type="submit">로그인</button>
            </div>
          </form>
          <form id="registerForm" class="card">
            <h3>회원가입</h3>
            <div class="field">
              <label for="registerName">이름</label>
              <input id="registerName" type="text" placeholder="홍길동" required>
            </div>
            <div class="field">
              <label for="registerEmail">이메일</label>
              <input id="registerEmail" type="email" placeholder="new@example.com" required>
            </div>
            <div class="field">
              <label for="registerPassword">비밀번호</label>
              <input id="registerPassword" type="password" placeholder="영문+숫자 8자 이상" required>
            </div>
            <div class="field">
              <label for="registerRole">가입 유형</label>
              <select id="registerRole">
                <option value="participant">참가자</option>
                <option value="organizer">운영자</option>
              </select>
            </div>
            <div class="action-row">
              <button class="secondary-btn" type="submit">계정 만들기</button>
            </div>
          </form>
        </section>
      </div>
      <aside class="panel sticky-box">
        <h3>데모 계정</h3>
        <div class="list compact-list">
          <div class="list-item">
            <strong>참가자</strong>
            <p class="muted">participant@example.com / demo1234</p>
          </div>
          <div class="list-item">
            <strong>운영자</strong>
            <p class="muted">organizer@example.com / demo1234</p>
          </div>
          <div class="list-item">
            <strong>관리자</strong>
            <p class="muted">admin@example.com / demo1234</p>
          </div>
        </div>
      </aside>
    </section>
  `;

  viewEl.querySelector("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = viewEl.querySelector("#loginEmail").value.trim();
    const password = viewEl.querySelector("#loginPassword").value.trim();
    try {
      const result = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      await applyAuthSession(result, `${result.user.name} 계정으로 로그인했습니다.`);
    } catch (error) {
      setFlash(error.message);
      renderApp();
    }
  });

  viewEl.querySelector("#registerForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = viewEl.querySelector("#registerName").value.trim();
    const email = viewEl.querySelector("#registerEmail").value.trim();
    const password = viewEl.querySelector("#registerPassword").value.trim();
    const role = viewEl.querySelector("#registerRole").value;
    try {
      const result = await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ name, email, password, role })
      });
      await applyAuthSession(result, `${result.user.name} 계정이 생성되었습니다.`);
    } catch (error) {
      setFlash(error.message);
      renderApp();
    }
  });
}

function setFlash(message) {
  state.flashMessage = message;
}

function consumeFlash() {
  flashEl.innerHTML = state.flashMessage ? `<div class="flash">${state.flashMessage}</div>` : "";
  state.flashMessage = "";
}

function renderParticipantHome() {
  const joinedChallenges = getJoinedChallenges();
  const activeChallenge = joinedChallenges[0];
  const progress = activeChallenge ? getUserProgress(activeChallenge, currentUserId()) : { approvedCount: 0, required: 0, ratio: 0 };
  const unreadNotices = getJoinedNotices().length;
  const wallet = state.data.wallet || { paidEntryFees: 0, pendingPayments: 0, expectedReward: 0, paidReward: 0 };

  viewEl.appendChild(htmlToNode(`
    <section class="grid cols-3">
      ${statCard("참여 중 챌린지", String(joinedChallenges.length), "현재 참가 중인 챌린지 수")}
      ${statCard("결제 대기", formatCurrency(wallet.pendingPayments), "아직 완료되지 않은 참가 결제")}
      ${statCard("납부 참가비", formatCurrency(wallet.paidEntryFees), "참가 완료된 챌린지 결제 합계")}
    </section>
  `));

  const wrapper = document.createElement("section");
  wrapper.className = "split";
  wrapper.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <div>
          <h2>추천 챌린지</h2>
          <p class="muted">상세 정보를 보고 참여 여부를 결정할 수 있습니다.</p>
        </div>
      </div>
      <div class="list">
        ${state.data.challenges.map(renderChallengeCardForParticipant).join("")}
      </div>
    </div>
    <aside class="panel sticky-box">
      <div class="panel-header">
        <div>
          <h2>내 상태 요약</h2>
          <p class="muted">지금 무엇을 해야 하는지 먼저 보여줍니다.</p>
        </div>
      </div>
      ${activeChallenge ? renderMyStatusBlock(activeChallenge) : `<div class="empty-state">참가한 챌린지가 없습니다.</div>`}
    </aside>
  `;
  attachChallengeCardEvents(wrapper);
  viewEl.appendChild(wrapper);
}

function renderChallengeExplore() {
  const section = document.createElement("section");
  section.className = "grid";
  section.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <div>
          <h2>모집 중 / 진행 중 챌린지</h2>
          <p class="muted">플랫폼, 참가비, 규칙, 공지와 이의제기 정책까지 확인할 수 있습니다.</p>
        </div>
      </div>
      <div class="list">
        ${state.data.challenges.map(renderChallengeCardForParticipant).join("")}
      </div>
    </div>
  `;
  attachChallengeCardEvents(section);
  viewEl.appendChild(section);
}

function renderChallengeDetail() {
  const challenge = getSelectedChallenge();
  const joined = challenge.participants.includes(currentUserId());
  const myPayment = getMyPayment(challenge);
  const ranking = calculateRanking(challenge);
  const notices = challenge.notices || [];

  const section = document.createElement("section");
  section.className = "split";
  section.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <div>
          <h2>${challenge.title}</h2>
          <div class="badge-row">
            ${statusBadge(challenge.status)}
            <span class="pill">${platformLabel(challenge.platform)}</span>
            <span class="pill">${challenge.participants.length}/${challenge.maxParticipants}명</span>
          </div>
        </div>
        <div class="action-row">
          <button class="ghost-btn" data-action="back-to-list">목록으로</button>
          ${renderParticipationActions(challenge, joined, myPayment)}
        </div>
      </div>
      <p class="muted">${challenge.description}</p>
      <div class="grid cols-3">
        ${statCard("참가비", formatCurrency(challenge.fee), "원화 기준 결제")}
        ${statCard("성공 기준", `${challenge.requiredSubmissions}회`, "승인된 제출 횟수 기준")}
        ${statCard("예상 상금 구조", challenge.settlementType === "equal" ? "균등 분배" : `상위 ${challenge.topN}명`, "모집 완료 후 계산")}
      </div>
      <div class="split no-sticky">
        <div class="card">
          <h3>참가 정책</h3>
          <ul class="bullet-list">
            <li>환불 정책: ${challenge.refundPolicy}</li>
            <li>이의제기 정책: ${challenge.appealPolicy}</li>
            <li>이미지 제출: ${challenge.imageRequired ? "필수" : "선택"}</li>
            <li>운영자: ${challenge.organizerName}</li>
          </ul>
        </div>
        <div class="card">
          <h3>결제 상태</h3>
          <p class="muted">${renderPaymentStatusText(myPayment)}</p>
        </div>
        <div class="card">
          <h3>최근 공지</h3>
          ${notices.length ? notices.slice(0, 3).map((notice) => `
            <div class="mini-notice">
              <strong>${notice.title}</strong>
              <p class="muted">${notice.body}</p>
              <span class="meta-inline">${formatDateTime(notice.createdAt)}</span>
            </div>
          `).join("") : `<div class="empty-state">등록된 공지가 없습니다.</div>`}
        </div>
      </div>
      <div class="panel-subsection">
        <div class="panel-header">
          <div>
            <h3>랭킹 미리보기</h3>
            <p class="muted">승인된 제출 수, 동점 시 마지막 승인 시각 기준</p>
          </div>
        </div>
        <table class="table">
          <thead>
            <tr><th>순위</th><th>참가자</th><th>승인 수</th></tr>
          </thead>
          <tbody>
            ${ranking.slice(0, 5).map((row, index) => `
              <tr><td>${index + 1}</td><td>${userLabel(row.userId)}</td><td>${row.approvedCount}</td></tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
    <aside class="panel sticky-box">
      <h3>참가 전 체크</h3>
      <div class="list compact-list">
        <div class="list-item"><strong>제출 링크</strong><p class="muted">${platformLabel(challenge.platform)} 도메인만 허용</p></div>
        <div class="list-item"><strong>정산 단계</strong><p class="muted">운영자 확정 후 관리자 승인</p></div>
        <div class="list-item"><strong>분쟁 대응</strong><p class="muted">반려/결과 이의제기 접수 가능</p></div>
      </div>
    </aside>
  `;

  section.querySelector('[data-action="back-to-list"]').addEventListener("click", () => {
    state.currentView = "challenges";
    renderApp();
  });
  attachChallengeCardEvents(section);
  viewEl.appendChild(section);
}

function renderMyChallenges() {
  const challenges = getJoinedChallenges();
  const section = document.createElement("section");
  section.className = "grid";
  if (!challenges.length) {
    section.innerHTML = `<div class="empty-state">아직 참가한 챌린지가 없습니다. 챌린지 탐색에서 참여를 시작해 보세요.</div>`;
    viewEl.appendChild(section);
    return;
  }

  section.innerHTML = challenges.map((challenge) => {
    const progress = getUserProgress(challenge, currentUserId());
    const submissions = getUserSubmissions(challenge, currentUserId());
    const notices = challenge.notices || [];
    const myAppeals = getAppealsForChallengeAndUser(challenge.id, currentUserId());

    return `
      <article class="panel">
        <div class="panel-header">
          <div>
            <h2>${challenge.title}</h2>
            <div class="badge-row">
              ${statusBadge(challenge.status)}
              <span class="pill">${platformLabel(challenge.platform)}</span>
            </div>
          </div>
          <div class="action-row">
            <button class="ghost-btn" data-action="open-detail" data-id="${challenge.id}">상세 보기</button>
            <button class="primary-btn" data-action="open-submit" data-id="${challenge.id}">인증 제출</button>
          </div>
        </div>
        <div class="split">
          <div class="grid">
            <div class="progress-block">
              <strong>성공 진행률</strong>
              <div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, progress.ratio * 100)}%"></div></div>
              <span class="muted">승인 ${progress.approvedCount}회 / 필요 ${progress.required}회</span>
            </div>
            <table class="table">
              <thead>
                <tr><th>회차</th><th>링크</th><th>상태</th><th>검수 메모</th><th>이의제기</th></tr>
              </thead>
              <tbody>
                ${submissions.length ? submissions.map((submission) => `
                  <tr>
                    <td>${submission.round}회차</td>
                    <td><a href="${submission.link}" target="_blank" rel="noreferrer">${submission.link}</a></td>
                    <td>${statusBadge(submission.status)}</td>
                    <td>${submission.reviewNote || "-"}</td>
                    <td>${submission.status === "rejected" || submission.status === "resubmit"
                      ? `<button class="ghost-btn small-btn" data-action="appeal-submission" data-id="${challenge.id}" data-submission-id="${submission.id}">이의제기</button>`
                      : "-"}</td>
                  </tr>
                `).join("") : `<tr><td colspan="5">아직 제출이 없습니다.</td></tr>`}
              </tbody>
            </table>
          </div>
          <aside class="grid">
            <div class="card">
              <h3>예상 결과</h3>
              <p class="muted">현재 승인 수를 기준으로 계산한 상태입니다.</p>
              <div class="badge-row">
                ${progress.approvedCount >= progress.required ? `<span class="badge green">현재 성공 조건 달성</span>` : `<span class="badge amber">추가 제출 필요</span>`}
              </div>
              <p><strong>예상 상금:</strong> ${formatCurrency(getEstimatedReward(challenge))}</p>
              <p><strong>남은 필요 제출:</strong> ${Math.max(progress.required - progress.approvedCount, 0)}회</p>
            </div>
            <div class="card">
              <h3>운영 공지</h3>
              ${notices.length ? notices.slice(0, 2).map((notice) => `
                <div class="mini-notice"><strong>${notice.title}</strong><p class="muted">${notice.body}</p></div>
              `).join("") : `<p class="muted">등록된 공지가 없습니다.</p>`}
            </div>
            <div class="card">
              <div class="card-header">
                <div><h3>내 이의제기</h3><p class="muted">최근 접수한 분쟁/문의 내역</p></div>
                <button class="ghost-btn small-btn" data-action="appeal-result" data-id="${challenge.id}">결과 문의</button>
              </div>
              ${myAppeals.length ? myAppeals.slice(0, 2).map(renderAppealPreview).join("") : `<p class="muted">아직 접수한 이의제기가 없습니다.</p>`}
            </div>
          </aside>
        </div>
      </article>
    `;
  }).join("");

  bindMyChallengeActions(section);
  viewEl.appendChild(section);
}

function bindMyChallengeActions(section) {
  section.querySelectorAll('[data-action="open-submit"]').forEach((button) => {
    button.addEventListener("click", () => openSubmissionComposer(button.dataset.id));
  });
  section.querySelectorAll('[data-action="open-detail"]').forEach((button) => {
    button.addEventListener("click", () => openChallengeDetail(button.dataset.id));
  });
  section.querySelectorAll('[data-action="appeal-submission"]').forEach((button) => {
    button.addEventListener("click", async () => createAppeal(button.dataset.id, button.dataset.submissionId, "submission"));
  });
  section.querySelectorAll('[data-action="appeal-result"]').forEach((button) => {
    button.addEventListener("click", async () => createAppeal(button.dataset.id, null, "result"));
  });
}

function renderRanking() {
  const challenge = getSelectedChallenge() || state.data.challenges[0];
  const rankings = calculateRanking(challenge);
  const section = document.createElement("section");
  section.className = "grid";
  section.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <div>
          <h2>${challenge.title} 랭킹</h2>
          <p class="muted">기준: 승인된 제출 수, 동점 시 마지막 승인 시각이 빠른 순</p>
        </div>
        <div class="action-row">
          <select id="rankingChallengeSelect">
            ${state.data.challenges.map((item) => `<option value="${item.id}" ${item.id === challenge.id ? "selected" : ""}>${item.title}</option>`).join("")}
          </select>
        </div>
      </div>
      <table class="table">
        <thead><tr><th>순위</th><th>참가자</th><th>승인 수</th><th>최근 승인 시각</th></tr></thead>
        <tbody>
          ${rankings.map((row, index) => `
            <tr><td>${index + 1}</td><td>${userLabel(row.userId)}</td><td>${row.approvedCount}</td><td>${row.lastApprovedAt ? formatDateTime(row.lastApprovedAt) : "-"}</td></tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  section.querySelector("#rankingChallengeSelect").addEventListener("change", (event) => {
    state.selectedChallengeId = event.target.value;
    renderApp();
  });
  viewEl.appendChild(section);
}

function renderMyPage() {
  const joinedChallenges = getJoinedChallenges();
  const appeals = state.data.appeals.filter((appeal) => appeal.userId === currentUserId());
  const wallet = state.data.wallet || { paidEntryFees: 0, pendingPayments: 0, expectedReward: 0, paidReward: 0 };
  const section = document.createElement("section");
  section.className = "grid";
  section.innerHTML = `
    <section class="grid cols-3">
      ${statCard("참여 누적", `${joinedChallenges.length}개`, "현재 참가 기준")}
      ${statCard("결제 대기", formatCurrency(wallet.pendingPayments), "완료 전 참가 결제")}
      ${statCard("실지급 보상", formatCurrency(wallet.paidReward), "지급 완료된 누적 상금")}
    </section>
    <section class="split">
      <article class="panel">
        <div class="panel-header"><div><h2>참가 기록</h2><p class="muted">챌린지별 제출과 공지 현황</p></div></div>
        <div class="list">
          ${joinedChallenges.map((challenge) => {
            const progress = getUserProgress(challenge, currentUserId());
            const myPayment = getMyPayment(challenge);
            return `
              <div class="list-item">
                <div class="card-header">
                  <div>
                    <strong>${challenge.title}</strong>
                    <div class="badge-row">${statusBadge(challenge.status)}<span class="pill">승인 ${progress.approvedCount}/${progress.required}</span></div>
                  </div>
                  <button class="ghost-btn small-btn" data-action="open-detail" data-id="${challenge.id}">상세</button>
                </div>
                <p class="muted">공지 ${challenge.notices.length}건 · 예상 상금 ${formatCurrency(getEstimatedReward(challenge))} · 결제상태 ${paymentStatusLabel(myPayment?.status || "none")}</p>
              </div>
            `;
          }).join("")}
        </div>
      </article>
      <article class="panel">
        <div class="panel-header"><div><h2>이의제기 현황</h2><p class="muted">반려 및 결과 문의 내역</p></div></div>
        ${appeals.length ? appeals.map(renderAppealPreview).join("") : `<div class="empty-state">접수한 이의제기가 없습니다.</div>`}
      </article>
    </section>
    <section class="panel">
      <div class="panel-header"><div><h2>결제 / 환불 내역</h2><p class="muted">내 참가 결제 상태를 확인하고 모집 중인 건은 직접 환불할 수 있습니다.</p></div></div>
      <div class="list">
        ${state.data.challenges.map((challenge) => {
          const payment = getMyPayment(challenge);
          if (!payment) return "";
          return `
            <div class="list-item">
              <div class="card-header">
                <div><strong>${challenge.title}</strong><div class="badge-row">${statusBadge(payment.status)}</div></div>
                <div class="action-row">
                  ${payment.status === "pending" ? `<button class="secondary-btn small-btn" data-action="confirm-payment" data-payment-id="${payment.id}">결제 완료</button><button class="ghost-btn small-btn" data-action="cancel-payment" data-payment-id="${payment.id}">취소</button>` : ""}
                  ${payment.status === "paid" && challenge.status === "recruiting" ? `<button class="danger-btn small-btn" data-action="refund-payment" data-payment-id="${payment.id}">환불</button>` : ""}
                </div>
              </div>
              <p class="muted">결제금액 ${formatCurrency(payment.amount)} · 상태 ${paymentStatusLabel(payment.status)} · PG ${payment.provider || "mock"} · 결제키 ${payment.providerPaymentId || "-"} · 체크아웃 ${payment.checkoutUrl || "-"}</p>
            </div>
          `;
        }).join("") || `<div class="empty-state">결제 이력이 없습니다.</div>`}
      </div>
    </section>
    <section class="split">
      <article class="panel">
        <div class="panel-header"><div><h2>계정 정보</h2><p class="muted">현재 로그인한 계정 정보입니다.</p></div></div>
        <div class="list compact-list">
          <div class="list-item"><strong>이름</strong><p class="muted">${escapeHtml(state.currentUser?.name || "-")}</p></div>
          <div class="list-item"><strong>이메일</strong><p class="muted">${escapeHtml(state.currentUser?.email || "-")}</p></div>
          <div class="list-item"><strong>역할</strong><p class="muted">${roleLabel(state.currentRole)}</p></div>
        </div>
      </article>
      <form class="panel" id="passwordForm">
        <div class="panel-header"><div><h2>비밀번호 변경</h2><p class="muted">영문과 숫자를 포함한 8자 이상 비밀번호를 사용하세요.</p></div></div>
        <div class="field"><label for="currentPassword">현재 비밀번호</label><input id="currentPassword" type="password" required></div>
        <div class="field"><label for="newPassword">새 비밀번호</label><input id="newPassword" type="password" required></div>
        <div class="action-row"><button class="primary-btn" type="submit">비밀번호 변경</button></div>
      </form>
    </section>
  `;
  section.querySelectorAll('[data-action="open-detail"]').forEach((button) => {
    button.addEventListener("click", () => openChallengeDetail(button.dataset.id));
  });
  bindPaymentActions(section);
  section.querySelector("#passwordForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const currentPassword = section.querySelector("#currentPassword").value.trim();
    const newPassword = section.querySelector("#newPassword").value.trim();
    try {
      await api("/api/auth/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword })
      });
      setFlash("비밀번호를 변경했습니다.");
      renderApp();
    } catch (error) {
      setFlash(error.message);
      renderApp();
    }
  });
  viewEl.appendChild(section);
}

function renderOrganizerHome() {
  const queue = getReviewQueue();
  const openAppeals = state.data.appeals.filter((appeal) => appeal.status === "open");
  const wallet = state.data.wallet || { totalRevenue: 0, platformFee: 0, payoutDue: 0 };
  const section = document.createElement("section");
  section.className = "grid";
  section.innerHTML = `
    <section class="grid cols-3">
      ${statCard("누적 결제금액", formatCurrency(wallet.totalRevenue), "내 챌린지 총 거래액")}
      ${statCard("플랫폼 수수료", formatCurrency(wallet.platformFee), "예상 수익화 기준")}
      ${statCard("지급 예정 상금", formatCurrency(wallet.payoutDue), "미지급 정산 잔액")}
    </section>
    <section class="grid cols-2">
      <article class="panel">
        <div class="panel-header"><div><h2>운영 중인 챌린지</h2><p class="muted">모집, 진행, 검수, 정산 상태를 한 번에 확인합니다.</p></div></div>
        <div class="list">
          ${state.data.challenges.map((challenge) => `
            <div class="list-item">
              <div class="card-header">
                <div>
                  <strong>${challenge.title}</strong>
                  <div class="badge-row">${statusBadge(challenge.status)}${statusBadge(challenge.settlement.status)}</div>
                </div>
                <span class="pill">${challenge.participants.length}/${challenge.maxParticipants}명</span>
              </div>
              <div class="summary-row">
                <span class="pill">참가비 ${formatCurrency(challenge.fee)}</span>
                <span class="pill">공지 ${challenge.notices.length}건</span>
                <button class="ghost-btn small-btn" data-action="open-detail" data-id="${challenge.id}">상세</button>
              </div>
            </div>
          `).join("")}
        </div>
      </article>
      <article class="panel">
        <div class="panel-header"><div><h2>오늘 우선 처리</h2><p class="muted">분쟁과 정산 지연을 먼저 줄여야 합니다.</p></div></div>
        <div class="list">
          ${queue.slice(0, 3).map((item) => `
            <div class="list-item"><strong>${item.challenge.title}</strong><p class="muted">${userLabel(item.submission.userId)} · ${item.submission.round}회차 · ${formatDateTime(item.submission.createdAt)}</p>${statusBadge(item.submission.status)}</div>
          `).join("")}
          ${openAppeals.slice(0, 2).map((appeal) => `
            <div class="list-item"><strong>이의제기: ${findChallenge(appeal.challengeId).title}</strong><p class="muted">${appeal.title}</p>${statusBadge(appeal.status)}</div>
          `).join("")}
          ${!queue.length && !openAppeals.length ? `<div class="empty-state">우선 처리할 건이 없습니다.</div>` : ""}
        </div>
      </article>
    </section>
  `;
  section.querySelectorAll('[data-action="open-detail"]').forEach((button) => button.addEventListener("click", () => openChallengeDetail(button.dataset.id)));
  viewEl.appendChild(section);
}

function renderCreateChallenge() {
  const draft = state.draftChallenge;
  const section = document.createElement("section");
  section.className = "split";
  section.innerHTML = `
    <form class="panel" id="challengeForm">
      <div class="panel-header"><div><h2>새 챌린지 만들기</h2><p class="muted">실제 DB에 저장되는 챌린지를 생성합니다.</p></div></div>
      <div class="form-grid">
        <div class="field"><label for="title">챌린지 제목</label><input id="title" name="title" value="${escapeHtml(draft.title)}" required></div>
        <div class="field"><label for="platform">플랫폼</label><select id="platform" name="platform"><option value="blog" ${draft.platform === "blog" ? "selected" : ""}>블로그</option><option value="youtube" ${draft.platform === "youtube" ? "selected" : ""}>유튜브</option><option value="tiktok" ${draft.platform === "tiktok" ? "selected" : ""}>틱톡</option></select></div>
        <div class="field"><label for="fee">참가비</label><input id="fee" name="fee" type="number" min="0" value="${draft.fee}"></div>
        <div class="field"><label for="maxParticipants">최대 모집 인원</label><input id="maxParticipants" name="maxParticipants" type="number" min="1" value="${draft.maxParticipants}"></div>
        <div class="field"><label for="requiredSubmissions">성공 기준 제출 수</label><input id="requiredSubmissions" name="requiredSubmissions" type="number" min="1" value="${draft.requiredSubmissions}"></div>
        <div class="field"><label for="settlementType">정산 방식</label><select id="settlementType" name="settlementType"><option value="equal" ${draft.settlementType === "equal" ? "selected" : ""}>성공자 균등 분배</option><option value="topN" ${draft.settlementType === "topN" ? "selected" : ""}>상위 N명 분배</option></select></div>
        <div class="field"><label for="topN">상위 N명</label><input id="topN" name="topN" type="number" min="1" value="${draft.topN}"></div>
        <div class="field"><label for="imageRequired">이미지 필수 여부</label><select id="imageRequired" name="imageRequired"><option value="true" ${draft.imageRequired ? "selected" : ""}>필수</option><option value="false" ${!draft.imageRequired ? "selected" : ""}>선택</option></select></div>
      </div>
      <div class="field"><label for="description">설명</label><textarea id="description" name="description">${escapeHtml(draft.description)}</textarea></div>
      <div class="action-row"><button class="secondary-btn" type="button" id="saveDraftButton">입력값 유지</button><button class="primary-btn" type="submit">챌린지 공개</button></div>
    </form>
    <aside class="panel sticky-box">
      <div class="panel-header"><div><h2>생성 미리보기</h2><p class="muted">입력값이 실제 카드로 어떻게 보이는지 확인합니다.</p></div></div>
      <div class="challenge-card">
        <div class="badge-row"><span class="badge gray">초안</span><span class="pill">${platformLabel(draft.platform)}</span></div>
        <h3>${escapeHtml(draft.title || "챌린지 제목을 입력하세요")}</h3>
        <p class="muted">${escapeHtml(draft.description || "챌린지 설명이 여기에 표시됩니다.")}</p>
        <div class="challenge-meta">
          <div class="meta-box"><span class="muted">참가비</span><strong>${formatCurrency(Number(draft.fee || 0))}</strong></div>
          <div class="meta-box"><span class="muted">성공 기준</span><strong>${draft.requiredSubmissions}회 제출</strong></div>
          <div class="meta-box"><span class="muted">정원</span><strong>${draft.maxParticipants}명</strong></div>
          <div class="meta-box"><span class="muted">정산</span><strong>${draft.settlementType === "equal" ? "균등 분배" : `상위 ${draft.topN}명 분배`}</strong></div>
        </div>
      </div>
    </aside>
  `;

  const form = section.querySelector("#challengeForm");
  const updateDraft = () => {
    const formData = new FormData(form);
    state.draftChallenge = {
      title: formData.get("title"),
      platform: formData.get("platform"),
      fee: Number(formData.get("fee")),
      maxParticipants: Number(formData.get("maxParticipants")),
      requiredSubmissions: Number(formData.get("requiredSubmissions")),
      settlementType: formData.get("settlementType"),
      topN: Number(formData.get("topN")),
      description: formData.get("description"),
      imageRequired: formData.get("imageRequired") === "true"
    };
  };

  form.addEventListener("input", () => {
    updateDraft();
    renderCreateChallenge();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    updateDraft();
    await api("/api/challenges", {
      method: "POST",
      body: JSON.stringify({
        ...state.draftChallenge,
        organizerName: "운영자 A",
        refundPolicy: "모집 기간 내 취소 가능",
        appealPolicy: "반려 후 3일 이내 이의제기 가능"
      })
    });
    setFlash("새 챌린지를 공개했습니다.");
    state.currentView = "org-home";
    renderApp();
  });
  section.querySelector("#saveDraftButton").addEventListener("click", () => {
    updateDraft();
    setFlash("입력값을 유지했습니다.");
    renderApp();
  });
  viewEl.appendChild(section);
}

function renderReviewQueue() {
  const queue = getReviewQueue();
  const section = document.createElement("section");
  section.className = "grid";
  section.innerHTML = `
    <div class="panel">
      <div class="panel-header"><div><h2>검수 대기 목록</h2><p class="muted">제출물을 승인, 반려, 재제출 요청 상태로 관리합니다.</p></div></div>
      ${queue.length ? `
        <table class="table">
          <thead><tr><th>챌린지</th><th>참가자</th><th>회차</th><th>제출물</th><th>액션</th></tr></thead>
          <tbody>
            ${queue.map((item) => `
              <tr>
                <td>${item.challenge.title}</td>
                <td>${userLabel(item.submission.userId)}</td>
                <td>${item.submission.round}회차</td>
                <td>
                  <div class="badge-row">${statusBadge(item.submission.status)}</div>
                  <p class="file-note"><a href="${item.submission.link}" target="_blank" rel="noreferrer">${item.submission.link}</a></p>
                  <p class="file-note">${item.submission.note || "메모 없음"}</p>
                  ${item.submission.imagePath ? `<img class="thumbnail" src="${item.submission.imagePath}" alt="제출 이미지">` : ""}
                </td>
                <td>
                  <div class="action-row">
                    <button class="secondary-btn small-btn" data-review-action="approve" data-submission-id="${item.submission.id}">승인</button>
                    <button class="danger-btn small-btn" data-review-action="reject" data-submission-id="${item.submission.id}">반려</button>
                    <button class="ghost-btn small-btn" data-review-action="resubmit" data-submission-id="${item.submission.id}">재제출요청</button>
                  </div>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      ` : `<div class="empty-state">현재 검수 대기 건이 없습니다.</div>`}
    </div>
  `;

  section.querySelectorAll("[data-review-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const reviewNote = window.prompt("검수 메모를 입력하세요.", button.dataset.reviewAction === "approve" ? "기준 충족으로 승인합니다." : "보완 후 다시 제출해 주세요.");
      if (reviewNote === null) return;
      await api(`/api/submissions/${button.dataset.submissionId}/review`, {
        method: "POST",
        body: JSON.stringify({ action: button.dataset.reviewAction, reviewNote })
      });
      setFlash(`제출 상태를 반영했습니다.`);
      renderApp();
    });
  });
  viewEl.appendChild(section);
}

function renderNoticeManager() {
  const challenge = getSelectedChallenge() || state.data.challenges[0];
  const section = document.createElement("section");
  section.className = "split";
  section.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <div><h2>운영 공지 목록</h2><p class="muted">참가자에게 보여 줄 안내와 정책 변경 이력을 관리합니다.</p></div>
        <div class="action-row">
          <select id="noticeChallengeSelect">${state.data.challenges.map((item) => `<option value="${item.id}" ${item.id === challenge.id ? "selected" : ""}>${item.title}</option>`).join("")}</select>
        </div>
      </div>
      <div class="list">
        ${challenge.notices.length ? challenge.notices.map((notice) => `
          <div class="list-item"><div class="card-header"><div><strong>${notice.title}</strong><p class="muted">${notice.body}</p></div><span class="pill">${formatDateTime(notice.createdAt)}</span></div></div>
        `).join("") : `<div class="empty-state">등록된 공지가 없습니다.</div>`}
      </div>
    </div>
    <aside class="panel sticky-box">
      <h3>새 공지 등록</h3>
      <div class="field"><label for="noticeTitle">공지 제목</label><input id="noticeTitle" placeholder="예: 최종 제출 마감 안내"></div>
      <div class="field"><label for="noticeBody">공지 내용</label><textarea id="noticeBody" placeholder="참가자에게 보여 줄 공지를 입력하세요."></textarea></div>
      <button class="primary-btn" id="createNoticeButton">공지 등록</button>
    </aside>
  `;

  section.querySelector("#noticeChallengeSelect").addEventListener("change", (event) => {
    state.selectedChallengeId = event.target.value;
    renderApp();
  });
  section.querySelector("#createNoticeButton").addEventListener("click", async () => {
    const title = section.querySelector("#noticeTitle").value.trim();
    const body = section.querySelector("#noticeBody").value.trim();
    if (!title || !body) {
      setFlash("공지 제목과 내용을 모두 입력해 주세요.");
      renderApp();
      return;
    }
    await api(`/api/challenges/${challenge.id}/notices`, {
      method: "POST",
      body: JSON.stringify({ title, body })
    });
    setFlash("운영 공지를 등록했습니다.");
    renderApp();
  });

  viewEl.appendChild(section);
}

function renderSettlement() {
  const section = document.createElement("section");
  section.className = "grid";
  section.innerHTML = state.data.challenges.map((challenge) => {
    const settlement = challenge.settlementSummary || calculateSettlement(challenge);
    const settlementStatus = challenge.settlement?.status || "preview";
    return `
      <article class="panel">
        <div class="panel-header">
          <div><h2>${challenge.title}</h2><div class="badge-row">${statusBadge(challenge.status)}${statusBadge(settlementStatus)}</div></div>
          <div class="action-row">
            <button class="secondary-btn" data-settlement-action="preview" data-id="${challenge.id}">정산미리</button>
            <button class="primary-btn" data-settlement-action="confirm" data-id="${challenge.id}" ${["confirmed","admin_approved","paid"].includes(settlementStatus) ? "disabled" : ""}>정산 확정</button>
          </div>
        </div>
        <div class="timeline-row">${renderSettlementTimeline(challenge.settlement)}</div>
        <div class="grid cols-3">
          ${statCard("총 결제금액", formatCurrency(settlement.totalRevenue), "참가자 수 x 참가비")}
          ${statCard("플랫폼 수수료", formatCurrency(settlement.platformFee), "수익화 예정 금액")}
          ${statCard("지급 가능 상금", formatCurrency(settlement.distributable), "수수료 차감 후")}
        </div>
        <table class="table">
          <thead><tr><th>수상자</th><th>승인 수</th><th>예상 지급액</th></tr></thead>
          <tbody>
            ${settlement.winners.length ? settlement.winners.map((winner) => `
              <tr><td>${userLabel(winner.userId)}</td><td>${winner.approvedCount}</td><td>${formatCurrency(winner.reward)}</td></tr>
            `).join("") : `<tr><td colspan="3">현재 성공자가 없습니다.</td></tr>`}
          </tbody>
        </table>
      </article>
    `;
  }).join("");

  section.querySelectorAll("[data-settlement-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/challenges/${button.dataset.id}/settlement/${button.dataset.settlementAction}`, { method: "POST" });
      setFlash(button.dataset.settlementAction === "confirm" ? "정산 확정 상태로 변경했습니다." : "정산 계산 결과를 새로 반영했습니다.");
      renderApp();
    });
  });
  viewEl.appendChild(section);
}

function renderAdminHome() {
  const pendingSettlements = state.data.challenges.filter((challenge) => challenge.settlement.status === "confirmed").length;
  const openAppeals = state.data.appeals.filter((appeal) => appeal.status === "open").length;
  const wallet = state.data.wallet || { totalRevenue: 0, totalPlatformFee: 0, totalPaid: 0 };
  const section = document.createElement("section");
  section.className = "grid";
  section.innerHTML = `
    <section class="grid cols-3">
      ${statCard("정산 승인 대기", String(pendingSettlements), "운영자 확정 후 관리자 검토 필요")}
      ${statCard("누적 플랫폼 수수료", formatCurrency(wallet.totalPlatformFee), "전체 챌린지 기준")}
      ${statCard("지급 완료 상금", formatCurrency(wallet.totalPaid), "완료 처리된 총 지급액")}
    </section>
    <section class="grid cols-2">
      <article class="panel">
        <div class="panel-header"><div><h2>정산 승인 대기</h2><p class="muted">운영자 확정 이후 관리자 승인 순서로 진행합니다.</p></div></div>
        <div class="list">
          ${state.data.challenges.filter((challenge) => challenge.settlement.status === "confirmed").map((challenge) => `
            <div class="list-item">
              <div class="card-header"><div><strong>${challenge.title}</strong><div class="badge-row">${statusBadge(challenge.settlement.status)}</div></div><button class="ghost-btn small-btn" data-action="goto-approvals">이동</button></div>
            </div>
          `).join("") || `<div class="empty-state">승인 대기 중인 정산이 없습니다.</div>`}
        </div>
      </article>
      <article class="panel">
        <div class="panel-header"><div><h2>최근 운영 로그</h2><p class="muted">관리자 관점의 추적성 확인용</p></div></div>
        <div class="list">
          ${state.data.auditLogs.slice(0, 6).map((log) => `
            <div class="list-item"><strong>${log.action}</strong><p class="muted">${log.detail}</p><span class="meta-inline">${roleLabel(log.actorRole)} · ${formatDateTime(log.createdAt)}</span></div>
          `).join("")}
        </div>
      </article>
    </section>
  `;
  section.querySelectorAll('[data-action="goto-approvals"]').forEach((button) => {
    button.addEventListener("click", () => {
      state.currentView = "approvals";
      renderApp();
    });
  });
  viewEl.appendChild(section);
}

function renderAdminApprovals() {
  const pendingChallenges = state.data.challenges.filter((challenge) => ["confirmed", "admin_approved", "hold"].includes(challenge.settlement.status));
  const section = document.createElement("section");
  section.className = "grid";
  section.innerHTML = `
    <div class="panel">
      <div class="panel-header"><div><h2>정산 승인 / 지급 상태</h2><p class="muted">운영자 확정 이후 관리자 승인과 지급 처리 상태를 관리합니다.</p></div></div>
      ${pendingChallenges.length ? pendingChallenges.map((challenge) => {
        const settlement = challenge.settlementSummary || calculateSettlement(challenge);
        return `
          <div class="list-item">
            <div class="card-header">
              <div><strong>${challenge.title}</strong><div class="badge-row">${statusBadge(challenge.settlement.status)}<span class="pill">운영자 확정 ${challenge.settlement.organizerConfirmedAt ? formatDateTime(challenge.settlement.organizerConfirmedAt) : "-"}</span></div></div>
              <div class="action-row">
                <button class="secondary-btn small-btn" data-admin-action="approve" data-id="${challenge.id}" ${challenge.settlement.status !== "confirmed" ? "disabled" : ""}>관리자 승인</button>
                <button class="ghost-btn small-btn" data-admin-action="pay" data-id="${challenge.id}" ${challenge.settlement.status !== "admin_approved" ? "disabled" : ""}>지급 완료</button>
                <button class="danger-btn small-btn" data-admin-action="hold" data-id="${challenge.id}" ${challenge.settlement.status === "paid" ? "disabled" : ""}>보류</button>
              </div>
            </div>
            <p class="muted">지급 대상 ${settlement.winners.length}명 · 지급 가능 상금 ${formatCurrency(settlement.distributable)} · 수수료 ${formatCurrency(settlement.platformFee)}</p>
          </div>
        `;
      }).join("") : `<div class="empty-state">관리 대상 정산이 없습니다.</div>`}
    </div>
  `;
  section.querySelectorAll("[data-admin-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/challenges/${button.dataset.id}/settlement/${button.dataset.adminAction}`, { method: "POST" });
      setFlash("정산 상태를 반영했습니다.");
      renderApp();
    });
  });
  viewEl.appendChild(section);
}

function renderDisputes() {
  const section = document.createElement("section");
  section.className = "grid";
  section.innerHTML = `
    <div class="panel">
      <div class="panel-header"><div><h2>이의제기 목록</h2><p class="muted">반려 제출 및 결과 이의제기를 확인하고 답변을 남깁니다.</p></div></div>
      ${state.data.appeals.length ? `
        <table class="table">
          <thead><tr><th>챌린지</th><th>구분</th><th>참가자</th><th>내용</th><th>상태</th><th>액션</th></tr></thead>
          <tbody>
            ${state.data.appeals.map((appeal) => `
              <tr>
                <td>${findChallenge(appeal.challengeId).title}</td>
                <td>${appeal.type === "submission" ? "반려 이의" : "결과 문의"}</td>
                <td>${userLabel(appeal.userId)}</td>
                <td><strong>${appeal.title}</strong><p class="muted">${appeal.body}</p>${appeal.response ? `<p><strong>답변:</strong> ${appeal.response}</p>` : ""}</td>
                <td>${statusBadge(appeal.status)}</td>
                <td><button class="secondary-btn small-btn" data-action="answer-appeal" data-id="${appeal.id}">답변</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      ` : `<div class="empty-state">등록된 이의제기가 없습니다.</div>`}
    </div>
  `;
  section.querySelectorAll('[data-action="answer-appeal"]').forEach((button) => {
    button.addEventListener("click", async () => {
      const appeal = state.data.appeals.find((item) => item.id === button.dataset.id);
      const response = window.prompt("답변 내용을 입력하세요.", appeal.response || "확인 후 처리 결과를 안내드립니다.");
      if (response === null) return;
      await api(`/api/appeals/${appeal.id}/respond`, {
        method: "POST",
        body: JSON.stringify({ response: response.trim() })
      });
      setFlash("이의제기에 답변을 등록했습니다.");
      renderApp();
    });
  });
  viewEl.appendChild(section);
}

function renderChallengeCardForParticipant(challenge) {
  const joined = challenge.participants.includes(currentUserId());
  const progress = getUserProgress(challenge, currentUserId());
  const myPayment = getMyPayment(challenge);
  return `
    <article class="card challenge-card">
      <div class="card-header">
        <div>
          <h3>${challenge.title}</h3>
          <div class="badge-row">${statusBadge(challenge.status)}<span class="pill">${platformLabel(challenge.platform)}</span></div>
        </div>
        <span class="pill">${challenge.participants.length}/${challenge.maxParticipants}명</span>
      </div>
      <p class="muted">${challenge.description}</p>
      <div class="challenge-meta">
        <div class="meta-box"><span class="muted">참가비</span><strong>${formatCurrency(challenge.fee)}</strong></div>
        <div class="meta-box"><span class="muted">성공 기준</span><strong>${challenge.requiredSubmissions}회 제출</strong></div>
        <div class="meta-box"><span class="muted">예상 상금</span><strong>${formatCurrency(getEstimatedReward(challenge))}</strong></div>
        <div class="meta-box"><span class="muted">내 진행</span><strong>${progress.approvedCount}/${progress.required}</strong></div>
      </div>
      <div class="action-row">
        <button class="ghost-btn" data-action="open-detail" data-id="${challenge.id}">상세 보기</button>
        ${renderParticipationActions(challenge, joined, myPayment)}
      </div>
    </article>
  `;
}

function renderMyStatusBlock(challenge) {
  const progress = getUserProgress(challenge, currentUserId());
  const notices = challenge.notices || [];
  return `
    <div class="grid">
      <div class="badge-row">${statusBadge(challenge.status)}<span class="pill">${challenge.title}</span></div>
      <div class="progress-block">
        <strong>현재 승인 진행률</strong>
        <div class="progress-track"><div class="progress-fill" style="width:${Math.min(progress.ratio * 100, 100)}%"></div></div>
        <span class="muted">승인 ${progress.approvedCount}회 / 성공까지 ${Math.max(progress.required - progress.approvedCount, 0)}회 남음</span>
      </div>
      <div class="card"><h3>다음 액션</h3><p class="muted">${progress.approvedCount >= progress.required ? "이미 성공 조건을 달성했습니다. 최종 정산을 기다리세요." : "다음 회차 인증을 제출해 성공 조건을 채우세요."}</p></div>
      <div class="card"><h3>최근 공지</h3><p class="muted">${notices[0] ? notices[0].title : "등록된 공지가 없습니다."}</p></div>
    </div>
  `;
}

function attachChallengeCardEvents(root) {
  root.querySelectorAll('[data-action="join"]').forEach((button) => button.addEventListener("click", async () => startChallengePayment(button.dataset.id)));
  root.querySelectorAll('[data-action="open-submit"]').forEach((button) => button.addEventListener("click", () => openSubmissionComposer(button.dataset.id)));
  root.querySelectorAll('[data-action="open-detail"]').forEach((button) => button.addEventListener("click", () => openChallengeDetail(button.dataset.id)));
  bindPaymentActions(root);
}

function openChallengeDetail(challengeId) {
  state.selectedChallengeId = challengeId;
  state.currentView = "challenge-detail";
  renderApp();
}

async function startChallengePayment(challengeId) {
  const response = await api(`/api/challenges/${challengeId}/payments/start`, {
    method: "POST",
    body: JSON.stringify({ userId: currentUserId() })
  });
  state.data = response;
  if (response.paymentId) {
    await api(`/api/payments/${response.paymentId}/confirm`, { method: "POST" });
  }
  setFlash("결제가 완료되어 챌린지 참가가 확정되었습니다.");
  renderApp();
}

function openSubmissionComposer(challengeId, inline = false) {
  const challenge = findChallenge(challengeId);
  const currentSubmissions = getUserSubmissions(challenge, currentUserId());
  const nextRound = currentSubmissions.length + 1;

  const section = document.createElement("section");
  section.className = "split";
  section.innerHTML = `
    <form class="panel" id="submissionForm">
      <div class="panel-header"><div><h2>${challenge.title}</h2><p class="muted">${nextRound}회차 인증 제출</p></div></div>
      <div class="field"><label for="submissionLink">콘텐츠 링크</label><input id="submissionLink" name="submissionLink" placeholder="https://"></div>
      <div class="field"><label for="submissionNote">메모</label><textarea id="submissionNote" name="submissionNote" placeholder="운영자에게 전달할 메모를 입력하세요."></textarea></div>
      <div class="field"><label for="submissionImage">이미지 첨부</label><input id="submissionImage" name="submissionImage" type="file" accept="image/*"><p class="file-note">실서비스용 업로드 흐름입니다.</p></div>
      <div class="action-row"><button class="ghost-btn" type="button" id="cancelSubmitButton">취소</button><button class="primary-btn" type="submit">제출 완료</button></div>
    </form>
    <aside class="panel sticky-box">
      <h3>제출 가이드</h3>
      <ul class="bullet-list muted"><li>챌린지 유형에 맞는 링크를 제출하세요.</li><li>이미지 필수 챌린지인 경우 인증 이미지를 첨부하세요.</li><li>제출 후 상태는 검수 큐로 이동합니다.</li></ul>
      <div class="card"><h3>이의제기 안내</h3><p class="muted">${challenge.appealPolicy}</p></div>
    </aside>
  `;

  section.querySelector("#cancelSubmitButton").addEventListener("click", () => {
    state.currentView = "my";
    renderApp();
  });

  section.querySelector("#submissionForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new FormData();
    body.append("userId", currentUserId());
    body.append("link", form.submissionLink.value.trim());
    body.append("note", form.submissionNote.value.trim());
    if (form.submissionImage.files[0]) body.append("image", form.submissionImage.files[0]);
    try {
      await api(`/api/challenges/${challenge.id}/submissions`, { method: "POST", body, isForm: true });
      setFlash("인증 제출이 완료되었습니다.");
      state.currentView = "my";
      renderApp();
    } catch (error) {
      setFlash(error.message);
      renderApp();
    }
  });

  if (!inline) {
    state.selectedChallengeId = challengeId;
    state.currentView = "submission-compose";
  }
  viewEl.innerHTML = "";
  viewEl.appendChild(section);
}

async function createAppeal(challengeId, submissionId, type) {
  const title = window.prompt(type === "submission" ? "반려 이의제기 제목을 입력하세요." : "결과 문의 제목을 입력하세요.", type === "submission" ? "반려 사유 재검토 요청" : "최종 결과 문의");
  if (!title) return;
  const body = window.prompt("상세 내용을 입력하세요.", "확인 후 재검토 부탁드립니다.");
  if (!body) return;
  await api("/api/appeals", {
    method: "POST",
    body: JSON.stringify({ challengeId, submissionId, userId: currentUserId(), type, title: title.trim(), body: body.trim() })
  });
  setFlash("이의제기를 접수했습니다.");
  renderApp();
}

function calculateRanking(challenge) {
  return [...new Set(challenge.participants)].map((userId) => {
    const approvedSubmissions = challenge.submissions
      .filter((submission) => submission.userId === userId && submission.status === "approved")
      .sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));
    return {
      userId,
      approvedCount: approvedSubmissions.length,
      lastApprovedAt: approvedSubmissions.length ? approvedSubmissions[approvedSubmissions.length - 1].updatedAt : null
    };
  }).sort((a, b) => {
    if (b.approvedCount !== a.approvedCount) return b.approvedCount - a.approvedCount;
    if (!a.lastApprovedAt && !b.lastApprovedAt) return 0;
    if (!a.lastApprovedAt) return 1;
    if (!b.lastApprovedAt) return -1;
    return new Date(a.lastApprovedAt) - new Date(b.lastApprovedAt);
  });
}

function calculateSettlement(challenge) {
  if (challenge.settlementSummary) return challenge.settlementSummary;
  const totalRevenue = challenge.participants.length * challenge.fee;
  const pgFee = Math.round(totalRevenue * 0.03);
  const platformFee = Math.round(totalRevenue * 0.1);
  const distributable = Math.max(totalRevenue - pgFee - platformFee, 0);
  const ranking = calculateRanking(challenge);
  const winners = ranking.filter((row) => row.approvedCount >= challenge.requiredSubmissions);
  if (!winners.length) return { totalRevenue, pgFee, platformFee, distributable, winners: [] };
  if ((challenge.settlementType || "equal") === "topN") {
    const ratios = [0.5, 0.3, 0.2];
    return { totalRevenue, pgFee, platformFee, distributable, winners: winners.slice(0, challenge.topN || 3).map((winner, index) => ({ ...winner, reward: Math.round(distributable * (ratios[index] || 0)) })) };
  }
  const reward = Math.floor(distributable / winners.length);
  return { totalRevenue, pgFee, platformFee, distributable, winners: winners.map((winner) => ({ ...winner, reward })) };
}

function renderSettlementTimeline(settlement) {
  const steps = [
    { label: "정산대기", done: true },
    { label: "운영자확정", done: ["confirmed", "admin_approved", "paid"].includes(settlement.status) },
    { label: "관리자승인", done: ["admin_approved", "paid"].includes(settlement.status) },
    { label: "지급완료", done: settlement.status === "paid" }
  ];
  return steps.map((step) => `<span class="timeline-chip ${step.done ? "done" : ""}">${step.label}</span>`).join("");
}

function getEstimatedReward(challenge) {
  const settlement = calculateSettlement(challenge);
  const mine = settlement.winners.find((winner) => winner.userId === currentUserId());
  return mine ? mine.reward : 0;
}

function getReviewQueue() {
  const queue = [];
  state.data.challenges.forEach((challenge) => {
    challenge.submissions.filter((submission) => submission.status === "submitted").forEach((submission) => queue.push({ challenge, submission }));
  });
  return queue.sort((a, b) => new Date(a.submission.createdAt) - new Date(b.submission.createdAt));
}

function getJoinedChallenges() {
  return state.data.challenges.filter((challenge) => challenge.participants.includes(currentUserId()));
}

function getJoinedNotices() {
  return getJoinedChallenges().flatMap((challenge) => challenge.notices || []);
}

function getUserSubmissions(challenge, userId) {
  return challenge.submissions.filter((submission) => submission.userId === userId).sort((a, b) => a.round - b.round);
}

function getUserProgress(challenge, userId) {
  const submissions = getUserSubmissions(challenge, userId);
  const approvedCount = submissions.filter((submission) => submission.status === "approved").length;
  const required = challenge.requiredSubmissions;
  return { approvedCount, required, ratio: required ? approvedCount / required : 0 };
}

function getAppealsForChallengeAndUser(challengeId, userId) {
  return state.data.appeals.filter((appeal) => appeal.challengeId === challengeId && appeal.userId === userId);
}

function getSelectedChallenge() {
  return findChallenge(state.selectedChallengeId) || state.data.challenges[0];
}

function findChallenge(id) {
  return state.data.challenges.find((challenge) => challenge.id === id);
}

function renderAppealPreview(appeal) {
  return `
    <div class="mini-appeal">
      <div class="badge-row">${statusBadge(appeal.status)}<span class="pill">${appeal.type === "submission" ? "반려 이의" : "결과 문의"}</span></div>
      <strong>${appeal.title}</strong>
      <p class="muted">${appeal.body}</p>
      ${appeal.response ? `<p><strong>답변:</strong> ${appeal.response}</p>` : `<p class="muted">아직 답변이 없습니다.</p>`}
    </div>
  `;
}

function userLabel(userId) {
  if (userId === "me") return "나";
  if (userId === "user-2") return "참가자 B";
  if (userId === "user-3") return "참가자 C";
  return userId;
}

function currentUserId() {
  return state.currentUser?.id || "me";
}

function getMyPayment(challenge) {
  return [...(challenge.payments || [])].reverse().find((payment) => payment.userId === currentUserId()) || null;
}

function paymentStatusLabel(status) {
  return statusLabelMap[status] || "결제없음";
}

function renderPaymentStatusText(payment) {
  if (!payment) return "아직 결제가 시작되지 않았습니다.";
  if (payment.status === "pending") return `참가비 ${formatCurrency(payment.amount)} 결제 대기 중입니다. PG: ${payment.provider || "mock"}`;
  if (payment.status === "paid") return `참가비 ${formatCurrency(payment.amount)} 결제가 완료되어 참가가 확정되었습니다. PG: ${payment.provider || "mock"}`;
  if (payment.status === "refunded") return "환불이 완료되었습니다.";
  if (payment.status === "cancelled") return "결제가 취소되었습니다.";
  return paymentStatusLabel(payment.status);
}

function renderParticipationActions(challenge, joined, myPayment) {
  if (joined) {
    return `<button class="secondary-btn" data-action="open-submit" data-id="${challenge.id}">인증 제출</button>`;
  }
  if (myPayment?.status === "pending") {
    return `
      <button class="secondary-btn" data-action="confirm-payment" data-payment-id="${myPayment.id}">결제 완료</button>
      <button class="ghost-btn" data-action="cancel-payment" data-payment-id="${myPayment.id}">취소</button>
    `;
  }
  return `<button class="primary-btn" data-action="join" data-id="${challenge.id}" ${challenge.participants.length >= challenge.maxParticipants ? "disabled" : ""}>결제 후 참가</button>`;
}

function bindPaymentActions(root) {
  root.querySelectorAll('[data-action="confirm-payment"]').forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/payments/${button.dataset.paymentId}/confirm`, { method: "POST" });
      setFlash("결제가 완료되어 참가가 확정되었습니다.");
      renderApp();
    });
  });
  root.querySelectorAll('[data-action="cancel-payment"]').forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/payments/${button.dataset.paymentId}/cancel`, { method: "POST" });
      setFlash("결제 대기를 취소했습니다.");
      renderApp();
    });
  });
  root.querySelectorAll('[data-action="refund-payment"]').forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/payments/${button.dataset.paymentId}/refund`, { method: "POST" });
      setFlash("환불을 완료했습니다.");
      renderApp();
    });
  });
}

function roleLabel(role) {
  if (role === "participant") return "참가자";
  if (role === "organizer") return "운영자";
  if (role === "admin") return "관리자";
  return role;
}

function platformLabel(platform) {
  if (platform === "blog") return "블로그";
  if (platform === "youtube") return "유튜브";
  return "틱톡";
}

function statusBadge(status) {
  const css = statusClassMap[status] || "gray";
  return `<span class="badge ${css}">${statusLabelMap[status] || status}</span>`;
}

function statCard(label, value, footnote) {
  return `<article class="stat-card"><p class="stat-label">${label}</p><strong class="stat-value">${value}</strong><span class="stat-footnote">${footnote}</span></article>`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function htmlToNode(html) {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

function escapeHtml(value) {
  return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

async function applyAuthSession(result, message) {
  state.sessionToken = result.token;
  state.currentUser = result.user;
  localStorage.setItem("challenge-manager-session-token", result.token);
  await refreshData();
  state.currentView = navConfig[state.currentRole][0].id;
  setFlash(message);
  renderApp();
}

async function api(url, options = {}) {
  const fetchOptions = { method: options.method || "GET", headers: {} };
  if (options.body) fetchOptions.body = options.body;
  if (!options.isForm && options.body) fetchOptions.headers["Content-Type"] = "application/json";
  if (state.sessionToken) fetchOptions.headers["x-session-token"] = state.sessionToken;
  const response = await fetch(url, fetchOptions);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "요청 처리에 실패했습니다.");
  if (data.challenges) state.data = data;
  return data;
}

function clearSession() {
  state.sessionToken = "";
  state.currentUser = null;
  state.currentRole = "participant";
  state.currentView = "home";
  localStorage.removeItem("challenge-manager-session-token");
}

bootstrap().catch((error) => {
  flashEl.innerHTML = `<div class="flash">초기 로딩 실패: ${error.message}</div>`;
});
