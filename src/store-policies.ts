import { AGENT_NAME, AGENT_ORIGIN } from "./agent-brand";
import { ABOUT_PATH, CONTACT_PATH, PRIVACY_PATH, SHIPPING_RETURNS_PATH, TERMS_PATH } from "./store-pages";
import { FEED_FILES, FEEDS_DIR } from "./feed-paths";
import { CUSTOM_PRINTS_RETURNABLE, RETURN_DAYS, RETURN_SHIPPING_PAID_BY, SHIPPING_COUNTRY, SHIPPING_MAX_DAYS, SHIPPING_MIN_DAYS, SUPPORT_EMAIL, SUPPORT_PHONE, SUPPORT_PHONE_E164 } from "./site-policy";

/**
 * Store policies for agents, built from the same constants the site, structured data, and
 * Stripe Checkout use. Says only what the site and checkout actually do.
 */
export const POLICIES_PATH = "/.well-known/policies.json";
export const POLICIES_API_PATH = "/api/policies";
export const POLICIES_REVISED = "2026-10-08";
/** Per checkout (the cart's limit). */
export const POLICY_MAX_QUANTITY = 6;

const shippingLine = `Free shipping to US addresses only. Delivery in ${SHIPPING_MIN_DAYS}–${SHIPPING_MAX_DAYS} days.`;
const returnsLine = `${RETURN_DAYS}-day money-back returns by mail, custom and uploaded-photo prints included. The buyer pays return shipping.`;
const paymentLine = "The buyer pays on Stripe Checkout (card, or another method Stripe shows them). Agents get a checkout link and never handle card data; creating the link charges nothing.";
const taxLine = "US sales tax is calculated by Stripe from the shipping address and added at checkout. Listed prices and quotes are before tax.";
const contactLine = `Email ${SUPPORT_EMAIL} or call ${SUPPORT_PHONE}.`;

export function storePolicies() {
  return {
    merchant: { name: AGENT_NAME, url: AGENT_ORIGIN },
    revised: POLICIES_REVISED,
    currency: "USD",
    shipping: {
      summary: shippingLine,
      countries: [SHIPPING_COUNTRY],
      cost_cents: 0,
      delivery_days: { min: SHIPPING_MIN_DAYS, max: SHIPPING_MAX_DAYS },
      included_in_price: true,
      policy_url: `${AGENT_ORIGIN}${SHIPPING_RETURNS_PATH}`,
    },
    returns: {
      summary: returnsLine,
      window_days: RETURN_DAYS,
      remedy: "money back",
      method: "by mail",
      return_shipping_paid_by: RETURN_SHIPPING_PAID_BY,
      custom_prints_returnable: CUSTOM_PRINTS_RETURNABLE,
      policy_url: `${AGENT_ORIGIN}${SHIPPING_RETURNS_PATH}#returns`,
    },
    payment: {
      summary: paymentLine,
      processor: "Stripe Checkout",
      methods: ["card"],
      other_methods: "Any other method Stripe Checkout shows the buyer.",
      promotion_codes: true,
      billing_address_required: true,
      agent_handles_card_data: false,
      checkout_link_expires_hours: 24,
      max_quantity_per_checkout: POLICY_MAX_QUANTITY,
    },
    tax: {
      summary: taxLine,
      calculated_by: "Stripe Tax",
      included_in_price: false,
      based_on: "shipping address",
    },
    contact: {
      summary: contactLine,
      email: SUPPORT_EMAIL,
      phone: SUPPORT_PHONE_E164,
      url: `${AGENT_ORIGIN}${CONTACT_PATH}`,
    },
    links: {
      terms: `${AGENT_ORIGIN}${TERMS_PATH}`,
      privacy: `${AGENT_ORIGIN}${PRIVACY_PATH}`,
      shipping_returns: `${AGENT_ORIGIN}${SHIPPING_RETURNS_PATH}`,
      contact: `${AGENT_ORIGIN}${CONTACT_PATH}`,
      about: `${AGENT_ORIGIN}${ABOUT_PATH}`,
      policies: `${AGENT_ORIGIN}${POLICIES_PATH}`,
      policies_api: `${AGENT_ORIGIN}${POLICIES_API_PATH}`,
      llms: `${AGENT_ORIGIN}/llms.txt`,
      openapi: `${AGENT_ORIGIN}/openapi.json`,
      mcp: `${AGENT_ORIGIN}/mcp`,
      a2a_agent_card: `${AGENT_ORIGIN}/.well-known/agent-card.json`,
      product_feeds: `${AGENT_ORIGIN}/${FEEDS_DIR}/${FEED_FILES.index}`,
    },
  };
}

/** One line per policy, for quote and checkout responses. */
export function policySummary() {
  return {
    shipping: shippingLine,
    returns: returnsLine,
    payment: paymentLine,
    tax: taxLine,
    contact: contactLine,
    details: `${AGENT_ORIGIN}${POLICIES_PATH}`,
  };
}
