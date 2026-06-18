const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const express = require("express");
const Database = require("better-sqlite3");
const multer = require("multer");
const { createPaymentGateway } = require("./payment-gateway");

const app = express();
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 4175);
const PUBLIC_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const NODE_ENV = process.env.NODE_ENV || "development";
const ENABLE_DEMO_SEED = parseBooleanEnv(process.env.ENABLE_DEMO_SEED, NODE_ENV !== "production");
const DATA_DIR = path.join(process.cwd(), "data");
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const DB_PATH = path.join(DATA_DIR, "challenge-manager.db");
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const LOGIN_WINDOW_MS = 1000 * 60 * 15;
const LOGIN_MAX_ATTEMPTS = 5;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
const paymentGateway = createPaymentGateway();

if (process.env.TRUST_PROXY === "1") {
  app.set("trust proxy", 1);
}

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use((req, _res, next) => {
  const token = req.header("x-session-token");
  const session = token ? db.prepare(`
    SELECT sessions.token, sessions.created_at, users.id, users.name, users.email, users.role
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token = ?
  `).get(token) : null;
  if (session && Date.now() - new Date(session.created_at).getTime() > SESSION_TTL_MS) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    req.auth = null;
  } else {
    req.auth = session;
  }
  next();
});
app.use(express.static(path.join(process.cwd(), "public")));

const upload = multer({ dest: UPLOAD_DIR });

initSchema();
seedIfEmpty();

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    date: new Date().toISOString(),
    environment: NODE_ENV,
    demoSeedEnabled: ENABLE_DEMO_SEED,
    provider: paymentGateway.provider,
    baseUrl: PUBLIC_BASE_URL
  });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  const emailKey = String(email || "").trim().toLowerCase();
  const remoteKey = req.ip || req.socket?.remoteAddress || "unknown";
  const limiter = getLoginLimiter(emailKey, remoteKey);
  if (limiter.locked) {
    return res.status(429).json({ error: `로그인 시도가 너무 많습니다. ${limiter.retryAfterMinutes}분 후 다시 시도해 주세요.` });
  }

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(emailKey);
  if (!user || !verifyPassword(password, user.password)) {
    registerLoginAttempt(emailKey, remoteKey, 0);
    return res.status(401).json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." });
  }
  registerLoginAttempt(emailKey, remoteKey, 1);
  const token = crypto.randomUUID();
  db.prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)").run(token, user.id, now());
  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    }
  });
});

app.post("/api/auth/register", (req, res) => {
  const { name, email, password, role } = req.body || {};
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedName = String(name || "").trim();
  const normalizedRole = role === "organizer" ? "organizer" : "participant";

  if (normalizedName.length < 2) {
    return res.status(400).json({ error: "이름은 2자 이상 입력해 주세요." });
  }
  if (!isValidEmail(normalizedEmail)) {
    return res.status(400).json({ error: "올바른 이메일 형식을 입력해 주세요." });
  }
  if (!isStrongPassword(password)) {
    return res.status(400).json({ error: "비밀번호는 8자 이상이며 영문과 숫자를 포함해야 합니다." });
  }
  const exists = db.prepare("SELECT 1 FROM users WHERE email = ?").get(normalizedEmail);
  if (exists) {
    return res.status(409).json({ error: "이미 사용 중인 이메일입니다." });
  }

  const userId = crypto.randomUUID();
  db.prepare("INSERT INTO users (id, name, email, password, role) VALUES (?, ?, ?, ?, ?)")
    .run(userId, normalizedName, normalizedEmail, hashPassword(password), normalizedRole);
  insertAuditLog(normalizedRole, "회원가입", `${normalizedName} / ${normalizedEmail}`);

  const token = crypto.randomUUID();
  db.prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)").run(token, userId, now());
  res.status(201).json({
    token,
    user: {
      id: userId,
      name: normalizedName,
      email: normalizedEmail,
      role: normalizedRole
    }
  });
});

app.post("/api/auth/logout", requireAuth, (req, res) => {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(req.auth.token);
  res.json({ ok: true });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({
    user: {
      id: req.auth.id,
      name: req.auth.name,
      email: req.auth.email,
      role: req.auth.role
    }
  });
});

app.post("/api/auth/password", requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.auth.id);
  if (!user || !verifyPassword(currentPassword, user.password)) {
    return res.status(400).json({ error: "현재 비밀번호가 일치하지 않습니다." });
  }
  if (!isStrongPassword(newPassword)) {
    return res.status(400).json({ error: "새 비밀번호는 8자 이상이며 영문과 숫자를 포함해야 합니다." });
  }
  if (verifyPassword(newPassword, user.password)) {
    return res.status(400).json({ error: "현재 비밀번호와 다른 비밀번호를 입력해 주세요." });
  }

  db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hashPassword(newPassword), req.auth.id);
  db.prepare("DELETE FROM sessions WHERE user_id = ? AND token != ?").run(req.auth.id, req.auth.token);
  insertAuditLog(req.auth.role, "비밀번호 변경", req.auth.email);
  res.json({ ok: true });
});

app.get("/api/bootstrap", requireAuth, (req, res) => {
  res.json(buildBootstrapPayload(req.auth));
});

app.post("/api/challenges", requireRole(["organizer", "admin"]), (req, res) => {
  const body = req.body || {};
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO challenges (
      id, title, platform, fee, max_participants, required_submissions, status,
      description, image_required, settlement_type, top_n, organizer_name,
      refund_policy, appeal_policy, owner_user_id
    ) VALUES (
      @id, @title, @platform, @fee, @maxParticipants, @requiredSubmissions, 'recruiting',
      @description, @imageRequired, @settlementType, @topN, @organizerName,
      @refundPolicy, @appealPolicy, @ownerUserId
    )
  `).run({
    id,
    title: body.title,
    platform: body.platform,
    fee: Number(body.fee || 0),
    maxParticipants: Number(body.maxParticipants || 1),
    requiredSubmissions: Number(body.requiredSubmissions || 1),
    description: body.description || "",
    imageRequired: body.imageRequired ? 1 : 0,
    settlementType: body.settlementType || "equal",
    topN: Number(body.topN || 3),
    organizerName: req.auth.name || body.organizerName || "운영자",
    refundPolicy: body.refundPolicy || "모집 기간 내 취소 가능",
    appealPolicy: body.appealPolicy || "반려 후 3일 이내 이의제기 가능",
    ownerUserId: req.auth.id
  });
  createSettlementRow(id);
  insertAuditLog(req.auth.role, "챌린지 공개", body.title || "새 챌린지");
  res.status(201).json(buildBootstrapPayload(req.auth));
});

app.post("/api/challenges/:id/payments/start", requireRole(["participant", "admin"]), (req, res) => {
  const challengeId = req.params.id;
  const userId = req.auth.id;
  const challenge = getChallengeRow(challengeId);
  if (!challenge) return res.status(404).json({ error: "챌린지를 찾을 수 없습니다." });

  const already = db.prepare("SELECT 1 FROM participants WHERE challenge_id = ? AND user_id = ?").get(challengeId, userId);
  if (already) return res.status(400).json({ error: "이미 참가한 챌린지입니다." });

  const currentCount = db.prepare("SELECT COUNT(*) AS count FROM participants WHERE challenge_id = ?").get(challengeId).count;
  if (currentCount >= challenge.max_participants) {
    return res.status(400).json({ error: "정원이 마감되었습니다." });
  }

  const payment = createOrReusePaymentRow(challengeId, userId, challenge.fee, "pending");
  insertAuditLog(req.auth.role, "결제 시작", `${challenge.title} / ${userLabel(userId)}`);
  res.json({ ...buildBootstrapPayload(req.auth), paymentId: payment.id, checkoutUrl: payment.checkout_url || null });
});

app.get("/api/payments/:id/checkout-config", requireRole(["participant", "admin"]), (req, res) => {
  const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(req.params.id);
  if (!payment) return res.status(404).json({ error: "결제 정보를 찾을 수 없습니다." });
  if (req.auth.role === "participant" && payment.user_id !== req.auth.id) {
    return res.status(403).json({ error: "본인 결제만 조회할 수 있습니다." });
  }
  const challenge = getChallengeRow(payment.challenge_id);
  res.json({
    provider: payment.provider,
    clientKey: process.env.TOSS_CLIENT_KEY || "",
    orderId: payment.order_id,
    orderName: challenge?.title || "Challenge Manager 결제",
    amount: payment.amount,
    customerName: req.auth.name,
    successUrl: buildAbsoluteUrl(`/api/payments/${payment.id}/callback/success`),
    failUrl: buildAbsoluteUrl(`/api/payments/${payment.id}/callback/fail`)
  });
});

app.get("/api/payments/:id/callback/success", async (req, res) => {
  const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(req.params.id);
  if (!payment) return res.status(404).send("결제 정보를 찾을 수 없습니다.");
  const { paymentKey, orderId, amount } = req.query;
  if (!paymentKey || !orderId || !amount) {
    return res.status(400).send("결제 성공 파라미터가 올바르지 않습니다.");
  }
  try {
    await confirmProviderPayment(payment.id, { paymentKey, orderId, amount: Number(amount) });
    res.send(`<html><body><script>location.href='/'</script><p>결제가 완료되었습니다. 잠시 후 메인 화면으로 이동합니다.</p></body></html>`);
  } catch (error) {
    res.status(500).send(`결제 승인 처리에 실패했습니다: ${escapeHtmlText(error.message)}`);
  }
});

app.get("/api/payments/:id/callback/fail", (req, res) => {
  const message = req.query.message ? escapeHtmlText(String(req.query.message)) : "결제가 취소되었거나 실패했습니다.";
  res.status(400).send(`<html><body><script>setTimeout(()=>location.href='/',1500)</script><p>${message}</p></body></html>`);
});

app.post("/api/webhooks/toss/payment", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const payloadText = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : JSON.stringify(req.body || {});
    const payload = payloadText ? JSON.parse(payloadText) : {};
    if (payload.eventType === "PAYMENT_STATUS_CHANGED" && payload.data?.orderId && payload.data?.status === "DONE") {
      const payment = db.prepare("SELECT * FROM payments WHERE order_id = ?").get(payload.data.orderId);
      if (payment && payment.status !== "paid") {
        await confirmProviderPayment(payment.id, {
          paymentKey: payload.data.paymentKey,
          orderId: payload.data.orderId,
          amount: Number(payload.data.totalAmount || payment.amount)
        });
      }
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message || "웹훅 처리에 실패했습니다." });
  }
});

app.post("/api/payments/:id/confirm", requireRole(["participant", "admin"]), async (req, res) => {
  const paymentId = req.params.id;
  const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentId);
  if (!payment) return res.status(404).json({ error: "결제 정보를 찾을 수 없습니다." });
  if (req.auth.role === "participant" && payment.user_id !== req.auth.id) {
    return res.status(403).json({ error: "본인 결제만 처리할 수 있습니다." });
  }
  if (payment.status !== "pending") {
    return res.status(400).json({ error: "결제 대기 상태에서만 완료 처리할 수 있습니다." });
  }

  const challenge = getChallengeRow(payment.challenge_id);
  const currentCount = db.prepare("SELECT COUNT(*) AS count FROM participants WHERE challenge_id = ?").get(payment.challenge_id).count;
  if (currentCount >= challenge.max_participants) {
    return res.status(400).json({ error: "정원이 마감되어 결제를 완료할 수 없습니다." });
  }
  await confirmProviderPayment(paymentId, req.body || {});
  insertAuditLog(req.auth.role, "결제 완료", `${challenge.title} / ${userLabel(payment.user_id)}`);
  res.json(buildBootstrapPayload(req.auth));
});

app.post("/api/payments/:id/cancel", requireRole(["participant", "admin"]), async (req, res) => {
  const paymentId = req.params.id;
  const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentId);
  if (!payment) return res.status(404).json({ error: "결제 정보를 찾을 수 없습니다." });
  if (req.auth.role === "participant" && payment.user_id !== req.auth.id) {
    return res.status(403).json({ error: "본인 결제만 취소할 수 있습니다." });
  }
  if (payment.status !== "pending") {
    return res.status(400).json({ error: "결제 대기 상태에서만 취소할 수 있습니다." });
  }

  const cancelResult = await paymentGateway.cancelPayment(payment);
  db.prepare("UPDATE payments SET status = 'cancelled', provider_status = ? WHERE id = ?")
    .run(cancelResult.providerStatus || "cancelled", paymentId);
  insertAuditLog(req.auth.role, "결제 취소", `${getChallengeRow(payment.challenge_id)?.title || payment.challenge_id} / ${userLabel(payment.user_id)}`);
  res.json(buildBootstrapPayload(req.auth));
});

app.post("/api/payments/:id/refund", requireRole(["participant", "admin"]), async (req, res) => {
  const paymentId = req.params.id;
  const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentId);
  if (!payment) return res.status(404).json({ error: "결제 정보를 찾을 수 없습니다." });
  const challenge = getChallengeRow(payment.challenge_id);
  if (req.auth.role === "participant" && payment.user_id !== req.auth.id) {
    return res.status(403).json({ error: "본인 결제만 환불 요청할 수 있습니다." });
  }
  if (payment.status !== "paid") {
    return res.status(400).json({ error: "결제 완료 건만 환불할 수 있습니다." });
  }
  if (req.auth.role === "participant") {
    const hasSubmissions = db.prepare("SELECT COUNT(*) AS count FROM submissions WHERE challenge_id = ? AND user_id = ?").get(payment.challenge_id, payment.user_id).count > 0;
    if (challenge.status !== "recruiting" || hasSubmissions) {
      return res.status(400).json({ error: "모집 중이며 제출 이력이 없는 경우에만 직접 환불할 수 있습니다." });
    }
  }

  const refundResult = await paymentGateway.refundPayment(payment, { cancelReason: req.body?.cancelReason || "사용자 요청 환불" });
  db.prepare("UPDATE payments SET status = 'refunded', refunded_at = ?, provider_status = ? WHERE id = ?")
    .run(refundResult.refundedAt || now(), refundResult.providerStatus || "refunded", paymentId);
  db.prepare("DELETE FROM participants WHERE challenge_id = ? AND user_id = ?").run(payment.challenge_id, payment.user_id);
  db.prepare("DELETE FROM payouts WHERE challenge_id = ? AND user_id = ? AND status != 'paid'").run(payment.challenge_id, payment.user_id);
  insertAuditLog(req.auth.role, "환불 완료", `${challenge.title} / ${userLabel(payment.user_id)}`);
  res.json(buildBootstrapPayload(req.auth));
});

app.post("/api/challenges/:id/notices", requireRole(["organizer", "admin"]), (req, res) => {
  const challengeId = req.params.id;
  const { title, body } = req.body || {};
  const challenge = getChallengeRow(challengeId);
  if (!challenge) return res.status(404).json({ error: "챌린지를 찾을 수 없습니다." });
  if (req.auth.role === "organizer" && challenge.owner_user_id !== req.auth.id) {
    return res.status(403).json({ error: "본인이 소유한 챌린지만 관리할 수 있습니다." });
  }
  db.prepare(`
    INSERT INTO notices (id, challenge_id, title, body, author_role, created_at)
    VALUES (?, ?, ?, ?, 'organizer', ?)
  `).run(crypto.randomUUID(), challengeId, title, body, now());
  insertAuditLog(req.auth.role, "공지 등록", `${getChallengeRow(challengeId)?.title || challengeId}: ${title}`);
  res.json(buildBootstrapPayload(req.auth));
});

app.post("/api/challenges/:id/submissions", requireRole(["participant", "admin"]), upload.single("image"), (req, res) => {
  const challengeId = req.params.id;
  const challenge = getChallengeRow(challengeId);
  if (!challenge) return res.status(404).json({ error: "챌린지를 찾을 수 없습니다." });

  const { link, note = "" } = req.body;
  const userId = req.auth.id;
  if (!link) return res.status(400).json({ error: "링크를 입력해 주세요." });
  if (!validateDomain(challenge.platform, link)) return res.status(400).json({ error: "챌린지 유형과 맞지 않는 링크입니다." });
  if (challenge.image_required && !req.file) return res.status(400).json({ error: "이미지 첨부가 필요합니다." });

  const currentCount = db.prepare("SELECT COUNT(*) AS count FROM submissions WHERE challenge_id = ? AND user_id = ?").get(challengeId, userId).count;
  const imagePath = req.file ? `/uploads/${path.basename(req.file.path)}` : "";

  db.prepare(`
    INSERT INTO submissions (
      id, challenge_id, user_id, round, link, note, image_name, image_path,
      status, review_note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'submitted', '', ?, ?)
  `).run(
    crypto.randomUUID(),
    challengeId,
    userId,
    currentCount + 1,
    link,
    note,
    req.file ? req.file.originalname : "",
    imagePath,
    now(),
    now()
  );

  insertAuditLog(req.auth.role, "인증 제출", `${challenge.title} / ${userLabel(userId)}`);
  res.status(201).json(buildBootstrapPayload(req.auth));
});

app.post("/api/submissions/:id/review", requireRole(["organizer", "admin"]), (req, res) => {
  const submissionId = req.params.id;
  const { action, reviewNote = "" } = req.body || {};
  const map = { approve: "approved", reject: "rejected", resubmit: "resubmit" };
  const status = map[action];
  if (!status) return res.status(400).json({ error: "잘못된 검수 액션입니다." });

  const submission = db.prepare("SELECT * FROM submissions WHERE id = ?").get(submissionId);
  if (!submission) return res.status(404).json({ error: "제출을 찾을 수 없습니다." });
  const challenge = getChallengeRow(submission.challenge_id);
  if (req.auth.role === "organizer" && challenge.owner_user_id !== req.auth.id) {
    return res.status(403).json({ error: "본인이 소유한 챌린지의 제출만 검수할 수 있습니다." });
  }

  db.prepare("UPDATE submissions SET status = ?, review_note = ?, updated_at = ? WHERE id = ?")
    .run(status, reviewNote, now(), submissionId);

  const pending = db.prepare("SELECT COUNT(*) AS count FROM submissions WHERE challenge_id = ? AND status = 'submitted'").get(submission.challenge_id).count;
  if (pending === 0) {
    db.prepare("UPDATE challenges SET status = 'review' WHERE id = ?").run(submission.challenge_id);
  }

  insertAuditLog(req.auth.role, `검수 ${statusLabel(status)}`, `${getChallengeRow(submission.challenge_id)?.title || submission.challenge_id}`);
  res.json(buildBootstrapPayload(req.auth));
});

app.post("/api/appeals", requireRole(["participant", "admin"]), (req, res) => {
  const { challengeId, submissionId = null, type, title, body } = req.body || {};
  const userId = req.auth.id;
  db.prepare(`
    INSERT INTO appeals (
      id, challenge_id, submission_id, user_id, type, title, body, status, response, created_at, responded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', '', ?, NULL)
  `).run(crypto.randomUUID(), challengeId, submissionId, userId, type, title, body, now());
  insertAuditLog(req.auth.role, "이의제기 접수", `${getChallengeRow(challengeId)?.title || challengeId}: ${title}`);
  res.status(201).json(buildBootstrapPayload(req.auth));
});

app.post("/api/appeals/:id/respond", requireRole(["organizer", "admin"]), (req, res) => {
  const appealId = req.params.id;
  const { response } = req.body || {};
  const appeal = db.prepare("SELECT * FROM appeals WHERE id = ?").get(appealId);
  if (!appeal) return res.status(404).json({ error: "이의제기를 찾을 수 없습니다." });
  const challenge = getChallengeRow(appeal.challenge_id);
  if (req.auth.role === "organizer" && challenge.owner_user_id !== req.auth.id) {
    return res.status(403).json({ error: "본인이 소유한 챌린지의 이의제기만 처리할 수 있습니다." });
  }
  db.prepare("UPDATE appeals SET response = ?, status = 'answered', responded_at = ? WHERE id = ?").run(response, now(), appealId);
  insertAuditLog(req.auth.role, "이의제기 답변", `${getChallengeRow(appeal.challenge_id)?.title || appeal.challenge_id}: ${appeal.title}`);
  res.json(buildBootstrapPayload(req.auth));
});

app.post("/api/challenges/:id/settlement/:action", requireRole(["organizer", "admin"]), (req, res) => {
  const challengeId = req.params.id;
  const action = req.params.action;
  const settlement = db.prepare("SELECT * FROM settlements WHERE challenge_id = ?").get(challengeId);
  if (!settlement) return res.status(404).json({ error: "정산 정보를 찾을 수 없습니다." });

  const challenge = getChallengeRow(challengeId);
  if (req.auth.role === "organizer" && challenge.owner_user_id !== req.auth.id) {
    return res.status(403).json({ error: "본인이 소유한 챌린지만 정산할 수 있습니다." });
  }
  if (action === "confirm") {
    if (req.auth.role === "participant") return res.status(403).json({ error: "권한이 없습니다." });
    db.prepare("UPDATE settlements SET status = 'confirmed', organizer_confirmed_at = ? WHERE challenge_id = ?").run(now(), challengeId);
    syncPayoutRows(challengeId);
    db.prepare("UPDATE challenges SET status = 'completed' WHERE id = ?").run(challengeId);
    insertAuditLog(req.auth.role, "정산 확정", challenge.title);
  } else if (action === "approve") {
    if (req.auth.role !== "admin") return res.status(403).json({ error: "관리자만 승인할 수 있습니다." });
    db.prepare("UPDATE settlements SET status = 'admin_approved', admin_approved_at = ? WHERE challenge_id = ?").run(now(), challengeId);
    db.prepare("UPDATE payouts SET status = 'approved', approved_at = ? WHERE challenge_id = ?").run(now(), challengeId);
    insertAuditLog(req.auth.role, "관리자 승인", challenge.title);
  } else if (action === "pay") {
    if (req.auth.role !== "admin") return res.status(403).json({ error: "관리자만 지급 완료 처리할 수 있습니다." });
    db.prepare("UPDATE settlements SET status = 'paid', paid_at = ? WHERE challenge_id = ?").run(now(), challengeId);
    db.prepare("UPDATE payouts SET status = 'paid', paid_at = ? WHERE challenge_id = ?").run(now(), challengeId);
    insertAuditLog(req.auth.role, "지급 완료", challenge.title);
  } else if (action === "hold") {
    if (req.auth.role !== "admin") return res.status(403).json({ error: "관리자만 보류 처리할 수 있습니다." });
    db.prepare("UPDATE settlements SET status = 'hold' WHERE challenge_id = ?").run(challengeId);
    db.prepare("UPDATE payouts SET status = 'hold' WHERE challenge_id = ? AND status != 'paid'").run(challengeId);
    insertAuditLog(req.auth.role, "정산 보류", challenge.title);
  } else if (action === "preview") {
    insertAuditLog(req.auth.role, "정산 미리보기", challenge.title);
  } else {
    return res.status(400).json({ error: "지원하지 않는 정산 액션입니다." });
  }

  res.json(buildBootstrapPayload(req.auth));
});

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Challenge Manager server running at ${PUBLIC_BASE_URL}`);
});

function shutdown(signal) {
  console.log(`${signal} received. Shutting down Challenge Manager server...`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      platform TEXT NOT NULL,
      fee INTEGER NOT NULL,
      max_participants INTEGER NOT NULL,
      required_submissions INTEGER NOT NULL,
      status TEXT NOT NULL,
      description TEXT NOT NULL,
      image_required INTEGER NOT NULL,
      settlement_type TEXT NOT NULL,
      top_n INTEGER NOT NULL,
      organizer_name TEXT NOT NULL,
      refund_policy TEXT NOT NULL,
      appeal_policy TEXT NOT NULL,
      owner_user_id TEXT
    );

    CREATE TABLE IF NOT EXISTS participants (
      challenge_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (challenge_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS notices (
      id TEXT PRIMARY KEY,
      challenge_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      author_role TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      challenge_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      round INTEGER NOT NULL,
      link TEXT NOT NULL,
      note TEXT NOT NULL,
      image_name TEXT NOT NULL,
      image_path TEXT NOT NULL,
      status TEXT NOT NULL,
      review_note TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settlements (
      challenge_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      organizer_confirmed_at TEXT,
      admin_approved_at TEXT,
      paid_at TEXT
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      challenge_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      order_id TEXT,
      amount INTEGER NOT NULL,
      pg_fee INTEGER NOT NULL,
      platform_fee INTEGER NOT NULL,
      provider TEXT NOT NULL DEFAULT 'mock',
      provider_payment_id TEXT,
      checkout_url TEXT,
      provider_status TEXT,
      status TEXT NOT NULL,
      paid_at TEXT,
      refunded_at TEXT
    );

    CREATE TABLE IF NOT EXISTS payouts (
      id TEXT PRIMARY KEY,
      challenge_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL,
      approved_at TEXT,
      paid_at TEXT,
      UNIQUE (challenge_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS appeals (
      id TEXT PRIMARY KEY,
      challenge_id TEXT NOT NULL,
      submission_id TEXT,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL,
      response TEXT NOT NULL,
      created_at TEXT NOT NULL,
      responded_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_role TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS login_attempts (
      key TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL,
      last_attempt_at TEXT NOT NULL,
      locked_until TEXT
    );
  `);

  const challengeColumns = db.prepare("PRAGMA table_info(challenges)").all();
  const hasOwnerColumn = challengeColumns.some((column) => column.name === "owner_user_id");
  if (!hasOwnerColumn) {
    db.exec("ALTER TABLE challenges ADD COLUMN owner_user_id TEXT");
  }

  db.prepare("UPDATE challenges SET owner_user_id = 'organizer-1' WHERE owner_user_id IS NULL OR owner_user_id = ''").run();
  ensureColumn("payments", "order_id", "TEXT");
  ensureColumn("payments", "provider", "TEXT NOT NULL DEFAULT 'mock'");
  ensureColumn("payments", "provider_payment_id", "TEXT");
  ensureColumn("payments", "checkout_url", "TEXT");
  ensureColumn("payments", "provider_status", "TEXT");
  migrateExistingPasswords();
  backfillFinancialRows();
}

function ensureColumn(tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = columns.some((column) => column.name === columnName);
  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function seedIfEmpty() {
  bootstrapAdminIfNeeded();
  if (!ENABLE_DEMO_SEED) return;
  ensureUsersSeeded();

  const count = db.prepare("SELECT COUNT(*) AS count FROM challenges").get().count;
  if (count > 0) return;

  const challenge1 = crypto.randomUUID();
  const challenge2 = crypto.randomUUID();
  const challenge3 = crypto.randomUUID();
  const rejectedSubmission = crypto.randomUUID();

  const insertChallenge = db.prepare(`
    INSERT INTO challenges (
      id, title, platform, fee, max_participants, required_submissions, status, description,
      image_required, settlement_type, top_n, organizer_name, refund_policy, appeal_policy, owner_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertChallenge.run(challenge1, "14일 블로그 습관 챌린지", "blog", 10000, 30, 5, "in_progress", "네이버/티스토리 블로그에 14일 동안 꾸준히 글을 올리고 인증하는 챌린지입니다.", 1, "equal", 3, "운영자 A", "모집 마감 전 전액 환불, 진행 시작 후 환불 불가", "반려 후 3일 이내 이의제기 가능", "organizer-1");
  insertChallenge.run(challenge2, "유튜브 주 3회 업로드 챌린지", "youtube", 15000, 40, 4, "recruiting", "유튜브 영상을 정해진 기간 안에 업로드하고 링크와 썸네일 이미지를 제출합니다.", 1, "topN", 3, "운영자 A", "모집 기간 중 취소 가능, 진행 시작 후 환불 불가", "결과 확정 후 2일 이내 이의제기 가능", "organizer-1");
  insertChallenge.run(challenge3, "틱톡 숏폼 7일 챌린지", "tiktok", 12000, 25, 3, "review", "7일 동안 틱톡 숏폼을 올리고 링크와 결과 이미지를 제출합니다.", 1, "equal", 3, "운영자 A", "모집 종료 전까지만 환불 가능", "반려 이의제기 가능, 최종 결과 확정 후 48시간 내 문의", "organizer-1");

  const insertParticipant = db.prepare("INSERT INTO participants (challenge_id, user_id, joined_at) VALUES (?, ?, ?)");
  [["me", challenge1], ["user-2", challenge1], ["user-3", challenge1], ["user-2", challenge2], ["user-2", challenge3], ["user-3", challenge3]]
    .forEach(([userId, challengeId]) => {
      insertParticipant.run(challengeId, userId, now());
      createOrReusePaymentRow(challengeId, userId, getChallengeRow(challengeId).fee, "paid");
    });

  const insertNotice = db.prepare("INSERT INTO notices (id, challenge_id, title, body, author_role, created_at) VALUES (?, ?, ?, ?, 'organizer', ?)");
  insertNotice.run(crypto.randomUUID(), challenge1, "2회차 제출 시 이미지 누락 주의", "블로그 링크만 제출된 경우 자동 승인되지 않습니다. 인증 이미지를 함께 첨부해 주세요.", now());
  insertNotice.run(crypto.randomUUID(), challenge1, "최종 정산 전 검수 일정 안내", "마지막 제출 검수는 종료 후 72시간 이내 처리됩니다.", now());
  insertNotice.run(crypto.randomUUID(), challenge2, "모집 마감 일정 안내", "모집 종료 후에는 링크 수정 없이 고정된 규칙으로만 진행됩니다.", now());

  const insertSubmission = db.prepare(`
    INSERT INTO submissions (
      id, challenge_id, user_id, round, link, note, image_name, image_path,
      status, review_note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, '', '', '', ?, ?, ?, ?)
  `);
  insertSubmission.run(crypto.randomUUID(), challenge1, "me", 1, "https://blog.naver.com/sample-post-1", "approved", "", now(), now());
  insertSubmission.run(crypto.randomUUID(), challenge1, "me", 2, "https://blog.naver.com/sample-post-2", "submitted", "", now(), now());
  insertSubmission.run(crypto.randomUUID(), challenge1, "user-2", 1, "https://blog.naver.com/another-post", "approved", "", now(), now());
  insertSubmission.run(crypto.randomUUID(), challenge1, "user-2", 2, "https://blog.naver.com/another-post-2", "approved", "", now(), now());
  insertSubmission.run(rejectedSubmission, challenge1, "user-3", 1, "https://blog.naver.com/rejected-post", "rejected", "링크는 제출했지만 이미지가 누락되었습니다.", now(), now());
  insertSubmission.run(crypto.randomUUID(), challenge3, "user-2", 1, "https://www.tiktok.com/@creator/video/1234", "approved", "", now(), now());
  insertSubmission.run(crypto.randomUUID(), challenge3, "user-2", 2, "https://www.tiktok.com/@creator/video/5678", "approved", "", now(), now());
  insertSubmission.run(crypto.randomUUID(), challenge3, "user-2", 3, "https://www.tiktok.com/@creator/video/91011", "approved", "", now(), now());
  insertSubmission.run(crypto.randomUUID(), challenge3, "user-3", 1, "https://www.tiktok.com/@creator/video/1213", "approved", "", now(), now());
  insertSubmission.run(crypto.randomUUID(), challenge3, "user-3", 2, "https://www.tiktok.com/@creator/video/1415", "submitted", "", now(), now());

  createSettlementRow(challenge1);
  createSettlementRow(challenge2);
  db.prepare("INSERT INTO settlements (challenge_id, status, organizer_confirmed_at, admin_approved_at, paid_at) VALUES (?, 'confirmed', ?, NULL, NULL)")
    .run(challenge3, now());
  syncPayoutRows(challenge3);

  db.prepare(`
    INSERT INTO appeals (id, challenge_id, submission_id, user_id, type, title, body, status, response, created_at, responded_at)
    VALUES (?, ?, ?, 'user-3', 'submission', ?, ?, 'open', '', ?, NULL)
  `).run(crypto.randomUUID(), challenge1, rejectedSubmission, "이미지 업로드 오류로 반려된 건 검토 요청", "제출 당시 이미지가 첨부되었는데 저장되지 않은 것 같습니다. 다시 확인 부탁드립니다.", now());

  insertAuditLog("organizer", "챌린지 생성", "14일 블로그 습관 챌린지 초안 공개");
  insertAuditLog("organizer", "검수 승인", "참가자 B 2회차 제출 승인");
  insertAuditLog("admin", "정산 모니터링", "틱톡 챌린지 정산 확정 대기");
}

function createSettlementRow(challengeId) {
  db.prepare("INSERT OR IGNORE INTO settlements (challenge_id, status, organizer_confirmed_at, admin_approved_at, paid_at) VALUES (?, 'preview', NULL, NULL, NULL)")
    .run(challengeId);
}

function buildBootstrapPayload(auth) {
  const challengeRows = auth.role === "organizer"
    ? db.prepare("SELECT * FROM challenges WHERE owner_user_id = ? ORDER BY rowid DESC").all(auth.id)
    : db.prepare("SELECT * FROM challenges ORDER BY rowid DESC").all();

  const challenges = challengeRows.map((challenge) => ({
    ...serializeChallenge(challenge, auth),
    settlementSummary: calculateSettlement(challenge.id)
  }));

  const visibleChallengeIds = new Set(challenges.map((challenge) => challenge.id));
  const visibleAppeals = db.prepare("SELECT * FROM appeals ORDER BY created_at DESC").all().filter((appeal) => {
    if (auth.role === "admin") return true;
    if (auth.role === "participant") return appeal.user_id === auth.id;
    return visibleChallengeIds.has(appeal.challenge_id);
  });

  return {
    version: 4,
    currentUser: auth ? {
      id: auth.id,
      name: auth.name,
      email: auth.email,
      role: auth.role
    } : null,
    challenges,
    appeals: visibleAppeals.map((appeal) => ({
      id: appeal.id,
      challengeId: appeal.challenge_id,
      submissionId: appeal.submission_id,
      userId: appeal.user_id,
      type: appeal.type,
      title: appeal.title,
      body: appeal.body,
      status: appeal.status,
      response: appeal.response,
      createdAt: appeal.created_at,
      respondedAt: appeal.responded_at
    })),
    auditLogs: db.prepare("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100").all().map((log) => ({
      id: log.id,
      actorRole: log.actor_role,
      action: log.action,
      detail: log.detail,
      createdAt: log.created_at
    })),
    wallet: buildWalletSummary(auth, challenges),
    metrics: buildMetricsSummary(auth, challenges)
  };
}

function serializeChallenge(challenge, auth) {
  const payments = db.prepare("SELECT * FROM payments WHERE challenge_id = ? ORDER BY paid_at ASC").all(challenge.id);
  const payouts = db.prepare("SELECT * FROM payouts WHERE challenge_id = ? ORDER BY amount DESC, user_id ASC").all(challenge.id);
  const visiblePayments = auth?.role === "participant" ? payments.filter((payment) => payment.user_id === auth.id) : payments;
  return {
    id: challenge.id,
    title: challenge.title,
    platform: challenge.platform,
    fee: challenge.fee,
    maxParticipants: challenge.max_participants,
    requiredSubmissions: challenge.required_submissions,
    status: challenge.status,
    description: challenge.description,
    imageRequired: Boolean(challenge.image_required),
    settlementType: challenge.settlement_type,
    topN: challenge.top_n,
    organizerName: challenge.organizer_name,
    ownerUserId: challenge.owner_user_id,
    refundPolicy: challenge.refund_policy,
    appealPolicy: challenge.appeal_policy,
    participants: db.prepare("SELECT user_id FROM participants WHERE challenge_id = ? ORDER BY joined_at ASC").all(challenge.id).map((row) => row.user_id),
    notices: db.prepare("SELECT * FROM notices WHERE challenge_id = ? ORDER BY created_at DESC").all(challenge.id).map((notice) => ({
      id: notice.id,
      challengeId: challenge.id,
      title: notice.title,
      body: notice.body,
      authorRole: notice.author_role,
      createdAt: notice.created_at
    })),
    submissions: db.prepare("SELECT * FROM submissions WHERE challenge_id = ? ORDER BY round ASC").all(challenge.id).map((submission) => ({
      id: submission.id,
      challengeId: submission.challenge_id,
      userId: submission.user_id,
      round: submission.round,
      link: submission.link,
      note: submission.note,
      imageName: submission.image_name,
      imagePath: submission.image_path,
      status: submission.status,
      reviewNote: submission.review_note,
      createdAt: submission.created_at,
      updatedAt: submission.updated_at
    })),
    settlement: (() => {
      const settlement = db.prepare("SELECT * FROM settlements WHERE challenge_id = ?").get(challenge.id);
      return {
        status: settlement.status,
        organizerConfirmedAt: settlement.organizer_confirmed_at,
        adminApprovedAt: settlement.admin_approved_at,
        paidAt: settlement.paid_at
      };
    })(),
    payments: visiblePayments.map((payment) => ({
      id: payment.id,
      userId: payment.user_id,
      orderId: payment.order_id,
      amount: payment.amount,
      pgFee: payment.pg_fee,
      platformFee: payment.platform_fee,
      provider: payment.provider,
      providerPaymentId: payment.provider_payment_id,
      checkoutUrl: payment.checkout_url,
      providerStatus: payment.provider_status,
      status: payment.status,
      paidAt: payment.paid_at,
      refundedAt: payment.refunded_at
    })),
    payouts: payouts.map((payout) => ({
      id: payout.id,
      userId: payout.user_id,
      amount: payout.amount,
      status: payout.status,
      approvedAt: payout.approved_at,
      paidAt: payout.paid_at
    }))
  };
}

function getChallengeRow(id) {
  return db.prepare("SELECT * FROM challenges WHERE id = ?").get(id);
}

function createOrReusePaymentRow(challengeId, userId, amount, status = "paid") {
  const exists = db.prepare("SELECT * FROM payments WHERE challenge_id = ? AND user_id = ? ORDER BY rowid DESC LIMIT 1").get(challengeId, userId);
  if (exists && ["pending", "paid"].includes(exists.status)) return exists;
  const challenge = getChallengeRow(challengeId);
  const id = crypto.randomUUID();
  const orderId = buildOrderId();
  const gatewayPayment = paymentGateway.createPayment({
    challengeId,
    userId,
    amount,
    orderId,
    orderName: challenge?.title || "Challenge Manager 결제",
    customerName: userLabel(userId),
    successUrl: buildAbsoluteUrl(`/api/payments/${id}/callback/success`),
    failUrl: buildAbsoluteUrl(`/api/payments/${id}/callback/fail`)
  });
  const pgFee = Math.round(amount * 0.03);
  const platformFee = Math.round(amount * 0.1);
  db.prepare(`
    INSERT INTO payments (
      id, challenge_id, user_id, order_id, amount, pg_fee, platform_fee,
      provider, provider_payment_id, checkout_url, provider_status, status, paid_at, refunded_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `).run(
    id,
    challengeId,
    userId,
    orderId,
    amount,
    pgFee,
    platformFee,
    gatewayPayment.provider || paymentGateway.provider || "mock",
    gatewayPayment.providerPaymentId || null,
    gatewayPayment.checkoutUrl || null,
    gatewayPayment.providerStatus || status,
    status,
    status === "paid" ? now() : null
  );
  return db.prepare("SELECT * FROM payments WHERE id = ?").get(id);
}

async function confirmProviderPayment(paymentId, confirmInput = {}) {
  const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentId);
  if (!payment) throw new Error("결제 정보를 찾을 수 없습니다.");
  let confirmResult;

  if (payment.provider === "toss") {
    confirmResult = await paymentGateway.confirmPayment({
      paymentKey: confirmInput.paymentKey,
      orderId: confirmInput.orderId || payment.order_id,
      amount: Number(confirmInput.amount || payment.amount)
    });
  } else {
    confirmResult = await paymentGateway.confirmPayment(payment);
  }

  db.prepare(`
    UPDATE payments
    SET status = 'paid', paid_at = ?, refunded_at = NULL, provider_payment_id = COALESCE(?, provider_payment_id), provider_status = ?
    WHERE id = ?
  `).run(
    confirmResult.approvedAt || now(),
    confirmResult.providerPaymentId || null,
    confirmResult.providerStatus || "paid",
    paymentId
  );
  db.prepare("INSERT OR IGNORE INTO participants (challenge_id, user_id, joined_at) VALUES (?, ?, ?)")
    .run(payment.challenge_id, payment.user_id, now());
}

function syncPayoutRows(challengeId) {
  const settlement = calculateSettlement(challengeId);
  const existingRows = db.prepare("SELECT user_id FROM payouts WHERE challenge_id = ?").all(challengeId);
  const existingUserIds = new Set(existingRows.map((row) => row.user_id));
  const winnerIds = new Set(settlement.winners.map((winner) => winner.userId));

  settlement.winners.forEach((winner) => {
    if (existingUserIds.has(winner.userId)) {
      db.prepare("UPDATE payouts SET amount = ?, status = CASE WHEN status = 'paid' THEN 'paid' ELSE 'pending' END, approved_at = NULL WHERE challenge_id = ? AND user_id = ?")
        .run(winner.reward, challengeId, winner.userId);
    } else {
      db.prepare(`
        INSERT INTO payouts (id, challenge_id, user_id, amount, status, approved_at, paid_at)
        VALUES (?, ?, ?, ?, 'pending', NULL, NULL)
      `).run(crypto.randomUUID(), challengeId, winner.userId, winner.reward);
    }
  });

  existingRows.forEach((row) => {
    if (!winnerIds.has(row.user_id)) {
      db.prepare("DELETE FROM payouts WHERE challenge_id = ? AND user_id = ? AND status != 'paid'").run(challengeId, row.user_id);
    }
  });
}

function calculateSettlement(challengeId) {
  const challenge = typeof challengeId === "string" ? getChallengeRow(challengeId) : challengeId;
  if (!challenge) {
    return { totalRevenue: 0, pgFee: 0, platformFee: 0, distributable: 0, winners: [], participantCount: 0 };
  }

  const participants = db.prepare("SELECT user_id FROM participants WHERE challenge_id = ? ORDER BY joined_at ASC").all(challenge.id);
  const submissions = db.prepare("SELECT * FROM submissions WHERE challenge_id = ? ORDER BY updated_at ASC").all(challenge.id);
  const totalRevenue = participants.length * challenge.fee;
  const pgFee = Math.round(totalRevenue * 0.03);
  const platformFee = Math.round(totalRevenue * 0.1);
  const distributable = Math.max(totalRevenue - pgFee - platformFee, 0);
  const ranking = [...new Set(participants.map((row) => row.user_id))].map((userId) => {
    const approvedSubmissions = submissions
      .filter((submission) => submission.user_id === userId && submission.status === "approved")
      .sort((a, b) => new Date(a.updated_at) - new Date(b.updated_at));
    return {
      userId,
      approvedCount: approvedSubmissions.length,
      lastApprovedAt: approvedSubmissions.length ? approvedSubmissions[approvedSubmissions.length - 1].updated_at : null
    };
  }).sort((a, b) => {
    if (b.approvedCount !== a.approvedCount) return b.approvedCount - a.approvedCount;
    if (!a.lastApprovedAt && !b.lastApprovedAt) return 0;
    if (!a.lastApprovedAt) return 1;
    if (!b.lastApprovedAt) return -1;
    return new Date(a.lastApprovedAt) - new Date(b.lastApprovedAt);
  });

  const eligible = ranking.filter((row) => row.approvedCount >= challenge.required_submissions);
  let winners = [];

  if (eligible.length) {
    if ((challenge.settlement_type || "equal") === "topN") {
      const ratios = [0.5, 0.3, 0.2];
      winners = eligible.slice(0, challenge.top_n || 3).map((winner, index) => ({
        ...winner,
        reward: Math.round(distributable * (ratios[index] || 0))
      }));
    } else {
      const reward = Math.floor(distributable / eligible.length);
      winners = eligible.map((winner) => ({ ...winner, reward }));
    }
  }

  return {
    totalRevenue,
    pgFee,
    platformFee,
    distributable,
    participantCount: participants.length,
    winners
  };
}

function buildWalletSummary(auth, challenges) {
  if (!auth) return null;
  if (auth.role === "participant") {
    const joined = challenges.filter((challenge) => challenge.participants.includes(auth.id));
    const pendingPayments = challenges.reduce((sum, challenge) => sum + challenge.payments.filter((payment) => payment.userId === auth.id && payment.status === "pending").reduce((acc, payment) => acc + payment.amount, 0), 0);
    const paid = joined.reduce((sum, challenge) => sum + challenge.payments.filter((payment) => payment.userId === auth.id && payment.status === "paid").reduce((acc, payment) => acc + payment.amount, 0), 0);
    const expectedReward = joined.reduce((sum, challenge) => sum + (challenge.settlementSummary.winners.find((winner) => winner.userId === auth.id)?.reward || 0), 0);
    const paidReward = joined.reduce((sum, challenge) => sum + challenge.payouts.filter((payout) => payout.userId === auth.id && payout.status === "paid").reduce((acc, payout) => acc + payout.amount, 0), 0);
    return { paidEntryFees: paid, pendingPayments, expectedReward, paidReward };
  }

  if (auth.role === "organizer") {
    const totalRevenue = challenges.reduce((sum, challenge) => sum + challenge.settlementSummary.totalRevenue, 0);
    const platformFee = challenges.reduce((sum, challenge) => sum + challenge.settlementSummary.platformFee, 0);
    const payoutDue = challenges.reduce((sum, challenge) => sum + challenge.payouts.filter((payout) => payout.status !== "paid").reduce((acc, payout) => acc + payout.amount, 0), 0);
    return { totalRevenue, platformFee, payoutDue };
  }

  const totalRevenue = challenges.reduce((sum, challenge) => sum + challenge.settlementSummary.totalRevenue, 0);
  const totalPlatformFee = challenges.reduce((sum, challenge) => sum + challenge.settlementSummary.platformFee, 0);
  const totalPaid = challenges.reduce((sum, challenge) => sum + challenge.payouts.filter((payout) => payout.status === "paid").reduce((acc, payout) => acc + payout.amount, 0), 0);
  return { totalRevenue, totalPlatformFee, totalPaid };
}

function buildMetricsSummary(auth, challenges) {
  const pendingPayouts = challenges.reduce((sum, challenge) => sum + challenge.payouts.filter((payout) => payout.status === "pending" || payout.status === "approved").length, 0);
  const paidPayouts = challenges.reduce((sum, challenge) => sum + challenge.payouts.filter((payout) => payout.status === "paid").length, 0);
  const activeChallenges = challenges.filter((challenge) => challenge.status !== "completed").length;
  return {
    role: auth.role,
    challengeCount: challenges.length,
    activeChallenges,
    pendingPayouts,
    paidPayouts
  };
}

function backfillFinancialRows() {
  const challenges = db.prepare("SELECT * FROM challenges").all();
  challenges.forEach((challenge) => {
    const participants = db.prepare("SELECT user_id FROM participants WHERE challenge_id = ?").all(challenge.id);
    participants.forEach((participant) => createOrReusePaymentRow(challenge.id, participant.user_id, challenge.fee, "paid"));
    const settlement = db.prepare("SELECT * FROM settlements WHERE challenge_id = ?").get(challenge.id);
    if (!settlement) return;
    if (["confirmed", "admin_approved", "paid", "hold"].includes(settlement.status)) {
      syncPayoutRows(challenge.id);
    }
    if (settlement.status === "admin_approved") {
      db.prepare("UPDATE payouts SET status = 'approved', approved_at = COALESCE(approved_at, ?) WHERE challenge_id = ? AND status != 'paid'")
        .run(settlement.admin_approved_at || now(), challenge.id);
    }
    if (settlement.status === "paid") {
      db.prepare("UPDATE payouts SET status = 'paid', approved_at = COALESCE(approved_at, ?), paid_at = COALESCE(paid_at, ?) WHERE challenge_id = ?")
        .run(settlement.admin_approved_at || settlement.paid_at || now(), settlement.paid_at || now(), challenge.id);
    }
    if (settlement.status === "hold") {
      db.prepare("UPDATE payouts SET status = 'hold' WHERE challenge_id = ? AND status != 'paid'").run(challenge.id);
    }
  });
}

function getLoginLimiter(email, remoteKey) {
  if (!email) return { locked: false, retryAfterMinutes: 0 };
  const key = `${email}|${remoteKey}`;
  const row = db.prepare("SELECT * FROM login_attempts WHERE key = ?").get(key);
  if (!row) return { locked: false, retryAfterMinutes: 0 };
  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    return {
      locked: true,
      retryAfterMinutes: Math.max(1, Math.ceil((new Date(row.locked_until).getTime() - Date.now()) / (1000 * 60)))
    };
  }
  return { locked: false, retryAfterMinutes: 0 };
}

function registerLoginAttempt(email, remoteKey, success) {
  if (!email) return;
  const key = `${email}|${remoteKey}`;
  const row = db.prepare("SELECT * FROM login_attempts WHERE key = ?").get(key);
  if (success) {
    db.prepare("DELETE FROM login_attempts WHERE key = ?").run(key);
    return;
  }

  const currentTime = now();
  const withinWindow = row && Date.now() - new Date(row.last_attempt_at).getTime() <= LOGIN_WINDOW_MS;
  const attempts = withinWindow ? row.attempts + 1 : 1;
  const lockedUntil = attempts >= LOGIN_MAX_ATTEMPTS ? new Date(Date.now() + LOGIN_WINDOW_MS).toISOString() : null;
  db.prepare(`
    INSERT INTO login_attempts (key, attempts, last_attempt_at, locked_until)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET attempts = excluded.attempts, last_attempt_at = excluded.last_attempt_at, locked_until = excluded.locked_until
  `).run(key, attempts, currentTime, lockedUntil);
}

function insertAuditLog(actorRole, action, detail) {
  db.prepare("INSERT INTO audit_logs (id, actor_role, action, detail, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(crypto.randomUUID(), actorRole, action, detail, now());
}

function validateDomain(platform, link) {
  const allow = {
    blog: ["blog.naver.com", "tistory.com", "brunch.co.kr", "velog.io", "medium.com"],
    youtube: ["youtube.com", "youtu.be"],
    tiktok: ["tiktok.com"]
  };
  try {
    const url = new URL(link);
    return allow[platform].some((host) => url.hostname.includes(host));
  } catch {
    return false;
  }
}

function userLabel(userId) {
  if (userId === "me") return "나";
  if (userId === "user-2") return "참가자 B";
  if (userId === "user-3") return "참가자 C";
  return userId;
}

function statusLabel(status) {
  const map = {
    approved: "승인",
    rejected: "반려",
    resubmit: "재제출요청"
  };
  return map[status] || status;
}

function now() {
  return new Date().toISOString();
}

function buildOrderId() {
  return `ord_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

function buildAbsoluteUrl(pathname) {
  return new URL(pathname, PUBLIC_BASE_URL).toString();
}

function escapeHtmlText(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

function isStrongPassword(password) {
  const value = String(password || "");
  return value.length >= 8 && /[A-Za-z]/.test(value) && /\d/.test(value);
}

function parseBooleanEnv(value, defaultValue) {
  if (value === undefined) return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function ensureUsersSeeded() {
  const count = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  if (count > 0) return;
  const insertUser = db.prepare("INSERT INTO users (id, name, email, password, role) VALUES (?, ?, ?, ?, ?)");
  insertUser.run("me", "참가자 A", "participant@example.com", hashPassword("demo1234"), "participant");
  insertUser.run("organizer-1", "운영자 A", "organizer@example.com", hashPassword("demo1234"), "organizer");
  insertUser.run("admin-1", "관리자 A", "admin@example.com", hashPassword("demo1234"), "admin");
}

function bootstrapAdminIfNeeded() {
  const count = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  if (count > 0) return;

  const adminEmail = String(process.env.BOOTSTRAP_ADMIN_EMAIL || "").trim().toLowerCase();
  const adminPassword = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || "").trim();
  const adminName = String(process.env.BOOTSTRAP_ADMIN_NAME || "Platform Admin").trim();

  if (!adminEmail || !adminPassword) return;
  if (!isValidEmail(adminEmail)) {
    throw new Error("BOOTSTRAP_ADMIN_EMAIL 형식이 올바르지 않습니다.");
  }
  if (!isStrongPassword(adminPassword)) {
    throw new Error("BOOTSTRAP_ADMIN_PASSWORD는 8자 이상이며 영문과 숫자를 포함해야 합니다.");
  }

  db.prepare("INSERT INTO users (id, name, email, password, role) VALUES (?, ?, ?, ?, ?)")
    .run(crypto.randomUUID(), adminName, adminEmail, hashPassword(adminPassword), "admin");
  insertAuditLog("system", "초기 관리자 생성", adminEmail);
}

function migrateExistingPasswords() {
  const users = db.prepare("SELECT id, password FROM users").all();
  const update = db.prepare("UPDATE users SET password = ? WHERE id = ?");
  users.forEach((user) => {
    if (!isHashedPassword(user.password)) {
      update.run(hashPassword(user.password), user.id);
    }
  });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derivedKey}`;
}

function verifyPassword(password, storedValue = "") {
  if (!isHashedPassword(storedValue)) {
    return password === storedValue;
  }
  const [, salt, storedKey] = storedValue.split("$");
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(storedKey, "hex"), derivedKey);
}

function isHashedPassword(value = "") {
  return typeof value === "string" && value.startsWith("scrypt$");
}

function requireAuth(req, res, next) {
  if (!req.auth) return res.status(401).json({ error: "로그인이 필요합니다." });
  next();
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!req.auth) return res.status(401).json({ error: "로그인이 필요합니다." });
    if (!roles.includes(req.auth.role)) return res.status(403).json({ error: "권한이 없습니다." });
    next();
  };
}
