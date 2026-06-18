const crypto = require("node:crypto");

function createPaymentGateway() {
  const provider = process.env.PAYMENT_PROVIDER || "mock";
  if (provider === "mock") {
    return createMockGateway();
  }
  if (provider === "toss") {
    return createTossGateway();
  }
  return createMockGateway();
}

function createMockGateway() {
  return {
    provider: "mock",
    createPayment({ challengeId, userId, amount }) {
      return {
        provider: "mock",
        providerPaymentId: `mock_pay_${crypto.randomUUID()}`,
        providerStatus: "ready",
        checkoutUrl: `/mock-payments/${challengeId}/${userId}`,
        amount
      };
    },
    confirmPayment(payment) {
      return {
        providerStatus: "paid",
        approvedAt: new Date().toISOString(),
        providerPaymentId: payment.provider_payment_id || payment.providerPaymentId
      };
    },
    cancelPayment(payment) {
      return {
        providerStatus: "cancelled",
        cancelledAt: new Date().toISOString(),
        providerPaymentId: payment.provider_payment_id || payment.providerPaymentId
      };
    },
    refundPayment(payment) {
      return {
        providerStatus: "refunded",
        refundedAt: new Date().toISOString(),
        providerPaymentId: payment.provider_payment_id || payment.providerPaymentId
      };
    }
  };
}

function createTossGateway() {
  const clientKey = process.env.TOSS_CLIENT_KEY || "";
  const secretKey = process.env.TOSS_SECRET_KEY || "";
  const baseUrl = process.env.TOSS_API_BASE_URL || "https://api.tosspayments.com";

  return {
    provider: "toss",
    createPayment({ amount, orderId, orderName, customerName, successUrl, failUrl }) {
      return {
        provider: "toss",
        providerPaymentId: null,
        providerStatus: "ready",
        checkoutUrl: null,
        clientKey,
        amount,
        orderId,
        orderName,
        customerName,
        successUrl,
        failUrl
      };
    },
    async confirmPayment({ paymentKey, orderId, amount }) {
      const response = await fetch(`${baseUrl}/v1/payments/confirm`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ paymentKey, orderId, amount })
      });
      const data = await response.json();
      if (!response.ok) {
        const error = new Error(data.message || data.code || "토스 결제 승인에 실패했습니다.");
        error.details = data;
        throw error;
      }
      return {
        providerStatus: data.status || "DONE",
        approvedAt: data.approvedAt || new Date().toISOString(),
        providerPaymentId: data.paymentKey
      };
    },
    async cancelPayment(payment) {
      return {
        providerStatus: payment.provider_status || "cancelled",
        cancelledAt: new Date().toISOString(),
        providerPaymentId: payment.provider_payment_id || null
      };
    },
    async refundPayment(payment, { cancelReason = "사용자 요청 환불" } = {}) {
      if (!payment.provider_payment_id) {
        throw new Error("토스 환불에는 provider payment key가 필요합니다.");
      }
      const response = await fetch(`${baseUrl}/v1/payments/${payment.provider_payment_id}/cancel`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID()
        },
        body: JSON.stringify({ cancelReason })
      });
      const data = await response.json();
      if (!response.ok) {
        const error = new Error(data.message || data.code || "토스 환불에 실패했습니다.");
        error.details = data;
        throw error;
      }
      return {
        providerStatus: data.status || "CANCELED",
        refundedAt: new Date().toISOString(),
        providerPaymentId: data.paymentKey || payment.provider_payment_id
      };
    }
  };
}

module.exports = {
  createPaymentGateway
};
