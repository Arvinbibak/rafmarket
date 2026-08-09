import { logger } from "./logger";

export type IrrPaymentResult = {
  success: boolean;
  authority?: string;
  paymentUrl?: string;
  message?: string;
};

const GATEWAY_URL =
  process.env.IRR_GATEWAY_URL ||
  "https://payment.zarinpal.com/pg/v4/payment/request.json";

const MERCHANT_ID =
  process.env.IRR_MERCHANT_ID || "";

const CALLBACK_URL =
  process.env.IRR_CALLBACK_URL || "";

export async function createIrrPayment(
  amount: number,
  description: string,
  metadata?: {
    orderId?: number;
    mobile?: string;
    email?: string;
  },
): Promise<IrrPaymentResult> {
  if (!MERCHANT_ID) {
    return {
      success: false,
      message: "IRR payment gateway is not configured",
    };
  }

  if (!CALLBACK_URL) {
    return {
      success: false,
      message: "IRR callback URL is not configured",
    };
  }

  if (!Number.isInteger(amount) || amount <= 0) {
    return {
      success: false,
      message: "Invalid payment amount",
    };
  }

  try {
    const response = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        merchant_id: MERCHANT_ID,
        amount,
        callback_url: CALLBACK_URL,
        description,
        metadata: {
          order_id: metadata?.orderId,
          mobile: metadata?.mobile,
          email: metadata?.email,
        },
      }),
    });

    const data = (await response.json()) as {
      data?: {
        code?: number;
        message?: string;
        authority?: string;
      };
      errors?: unknown;
    };

    if (!response.ok) {
      logger.error(
        {
          status: response.status,
          data,
        },
        "IRR gateway request failed",
      );

      return {
        success: false,
        message: "Iranian payment gateway request failed",
      };
    }

    const authority = data.data?.authority;

    if (!authority) {
      logger.error(
        { data },
        "IRR gateway did not return authority",
      );

      return {
        success: false,
        message:
          data.data?.message ||
          "Payment gateway did not return an authority",
      };
    }

    return {
      success: true,
      authority,
      paymentUrl: `https://www.zarinpal.com/pg/StartPay/${authority}`,
    };
  } catch (error) {
    logger.error(
      { error },
      "IRR gateway connection failed",
    );

    return {
      success: false,
      message:
        "Unable to connect to Iranian payment gateway",
    };
  }
}