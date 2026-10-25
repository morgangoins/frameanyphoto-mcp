import { AGENT_ORIGIN } from "./agent-brand";
import { RETURN_DAYS, SHIPPING_MAX_DAYS, SHIPPING_MIN_DAYS } from "./site-policy";
import { MAX_CART_ITEMS } from "./cart";
import { categoryOfferForSeries, listedFramesForCheckout, pickCategoryFrame } from "./category-frames";
import { loadCategoryFrames, printFramesCatalog } from "./checkout-frames";
import { createPrintCheckoutSession, getAgentCheckoutStatus, prepareCheckoutItem } from "./checkout";
import { isPaintingSeries, workOnSite, works, type Work } from "./collection";
import {
  checkoutPrintFrames,
  collagePrintSizesForWork,
  coverPrintCrop,
  customerPrintSizeName,
  defaultPrintSize,
  listedPrintFrames,
  paintingPrintBorderIn,
  printMatForFrame,
  printMatIsOn,
  printSizeIsOfferable,
  printSizeSkuId,
  type PrintFrame,
  type PrintSize,
} from "./print";
import { hiddenWorkIds, withoutHidden } from "./review";
import { policySummary } from "./store-policies";
import { normalizeWorkKey, workBySlugOrUrl, workCanonicalPath, workSlug } from "./work-url";

/**
 * Agent ordering reuses the site's own size list, frame list, crop, prices, and
 * Stripe Checkout session. Nothing here prices a print by itself: every number
 * comes from prepareCheckoutItem, the same function /api/checkout uses.
 */

export const SHIPS_TO = ["US"] as const;
export const MAX_AGENT_QUANTITY = MAX_CART_ITEMS;
const TAX_NOTE = "Sales tax is added by Stripe Checkout from the shipping address.";

type Args = Record<string, unknown>;
type Fail = { error: string; status: number };

function fail(error: string, status = 400): Fail {
  return { error, status };
}

function text(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}

/** Live works only: the review gate and the site's on-site rule apply to agents too. */
function liveWorks() {
  return withoutHidden(works, hiddenWorkIds()).filter((work) => workOnSite(work));
}

export function resolveOrderWork(value: unknown): Work | Fail {
  const raw = text(value, 200);
  const needle = raw ? normalizeWorkKey(raw) : "";
  if (!needle) return fail("work is required: a work id or slug from search_works or get_work");
  const live = liveWorks();
  const match = live.find((work) =>
    [work.id, work.accessionNumber, work.nasaId, work.title].some((field) => field && normalizeWorkKey(field) === needle));
  if (match) return match;
  const bySlug = workBySlugOrUrl(needle);
  return (bySlug && live.find((work) => work.id === bySlug.id)) || fail("Unknown work. Use search_works to find its id or slug.", 404);
}

function borderFor(work: Work, frameId: string) {
  return isPaintingSeries(work.series)
    ? paintingPrintBorderIn({ framed: true, matted: printMatIsOn(printMatForFrame(frameId)) })
    : 0;
}

/** The sizes the site's size menu enables for this work (100 PPI floor). */
function offeredSizes(work: Work) {
  return collagePrintSizesForWork(work.pixels, work.series).filter(printSizeIsOfferable);
}

/** The frames the site's frame menu lists for this size, default first. */
function offeredFrames(work: Work, size: PrintSize) {
  const offer = categoryOfferForSeries(work.series, loadCategoryFrames());
  const listed = listedPrintFrames({ widthIn: size.widthIn, heightIn: size.heightIn }, printFramesCatalog());
  const frames = checkoutPrintFrames(listedFramesForCheckout(listed, offer.frameId, true));
  const preferred = pickCategoryFrame(frames, offer.frameId);
  return { frames, defaultId: preferred?.id ?? frames[0]?.id ?? null };
}

function checkoutInput(work: Work, size: PrintSize, frame: PrintFrame) {
  const crop = coverPrintCrop(work.pixels, size.widthIn, size.heightIn, borderFor(work, frame.id));
  return {
    workId: work.id,
    sizeId: size.id,
    frameId: frame.id,
    matId: printMatForFrame(frame.id),
    matted: printMatIsOn(printMatForFrame(frame.id)),
    crop,
  };
}

function sizeName(size: PrintSize) {
  return customerPrintSizeName(size.name) ?? size.name;
}

function matchSize(sizes: PrintSize[], value: unknown) {
  const wanted = text(value, 40)?.toLowerCase().replaceAll("×", "x").replace(/\s+/g, "");
  if (!wanted) return null;
  return sizes.find((size) => [size.id, printSizeSkuId(size.name), sizeName(size)]
    .some((field) => field.toLowerCase().replaceAll("×", "x").replace(/\s+/g, "") === wanted)) ?? null;
}

function matchFrame(frames: PrintFrame[], value: unknown) {
  const wanted = text(value, 120)?.toLowerCase();
  if (!wanted) return null;
  return frames.find((frame) => frame.id.toLowerCase() === wanted || frame.label.toLowerCase() === wanted) ?? null;
}

function publicWork(work: Work) {
  return {
    id: work.id,
    ascii_id: workSlug(work),
    title: work.title,
    artist: work.artist,
    year: work.year,
    url: new URL(workCanonicalPath(work), AGENT_ORIGIN).toString(),
  };
}

export function printOptions(args: Args) {
  const work = resolveOrderWork(args.work);
  if ("error" in work) return work;
  return printOptionsForWork(work);
}

/** Print options for an already-resolved live work (the public catalog builds its index with this). */
export function printOptionsForWork(work: Work) {
  const sizes = offeredSizes(work);
  if (!sizes.length) return fail("This work is not offered as a print.", 409);
  const defaultSize = defaultPrintSize(sizes);
  const rows = sizes.flatMap((size) => {
    const { frames, defaultId } = offeredFrames(work, size);
    const priced = frames.flatMap((frame) => {
      const item = prepareCheckoutItem(checkoutInput(work, size, frame));
      return "error" in item ? [] : [{ frame, item }];
    });
    if (!priced.length) return [];
    const cents = priced[0].item.quote.goodsCents;
    return [{
      size_id: size.id,
      name: sizeName(size),
      label: priced[0].item.size.label,
      width_in: size.widthIn,
      height_in: size.heightIn,
      print_ppi: size.fitPpi,
      price_cents: cents,
      price_usd: cents / 100,
      ...(size.id === defaultSize?.id ? { default: true } : {}),
      frames: priced.map(({ frame, item }) => ({
        frame_id: frame.id,
        label: frame.label,
        ...(item.quote.goodsCents !== cents ? { price_cents: item.quote.goodsCents } : {}),
        ...(frame.id === defaultId ? { default: true } : {}),
      })),
    }];
  });
  if (!rows.length) return fail("This work is not offered as a print.", 409);
  return {
    work: publicWork(work),
    currency: "usd",
    ships_to: SHIPS_TO,
    includes: `Prices include the frame and US shipping. Delivery in ${SHIPPING_MIN_DAYS}–${SHIPPING_MAX_DAYS} days; ${RETURN_DAYS}-day returns.`,
    tax: TAX_NOTE,
    sizes: rows,
  };
}

type Line = { work: Work; size: PrintSize; frame: PrintFrame; quantity: number; input: ReturnType<typeof checkoutInput> };

function orderLine(args: Args): Line | Fail {
  const work = resolveOrderWork(args.work);
  if ("error" in work) return work;
  const sizes = offeredSizes(work);
  const size = args.size == null ? defaultPrintSize(sizes) ?? null : matchSize(sizes, args.size);
  if (!size) return fail(`Unknown size. Offered: ${sizes.map((entry) => `${entry.id} (${sizeName(entry)})`).join(", ") || "none"}.`);
  const { frames, defaultId } = offeredFrames(work, size);
  const frame = args.frame == null ? frames.find((entry) => entry.id === defaultId) ?? null : matchFrame(frames, args.frame);
  if (!frame) return fail(`Unknown frame for ${size.id}. Offered: ${frames.map((entry) => entry.id).join(", ") || "none"}.`);
  const quantity = args.quantity == null ? 1 : args.quantity;
  if (!Number.isInteger(quantity) || (quantity as number) < 1 || (quantity as number) > MAX_AGENT_QUANTITY) {
    return fail(`quantity must be a whole number from 1 to ${MAX_AGENT_QUANTITY}`);
  }
  return { work, size, frame, quantity: quantity as number, input: checkoutInput(work, size, frame) };
}

export type OrderLine = Line;

/** One order line resolved exactly like quote_order and create_checkout (ACP checkout uses this). */
export function resolveOrderLine(args: Args): Line | Fail {
  return orderLine(args);
}

/** Live works and their offered size ids, without pricing (the ACP item index uses this). */
export function liveOrderWorks() {
  return liveWorks();
}

export function offeredSizeIds(work: Work) {
  return offeredSizes(work).map((size) => size.id);
}

function shipToCheck(value: unknown): Fail | null {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return fail("ship_to must be an object with country, state, and zip");
  const ship = value as Args;
  const country = ship.country == null ? "US" : text(ship.country, 2)?.toUpperCase();
  if (!country || !(SHIPS_TO as readonly string[]).includes(country)) return fail("We ship to the United States only.", 422);
  if (ship.state != null && !/^[A-Za-z]{2}$/.test(String(ship.state))) return fail("ship_to.state must be a 2-letter US state code");
  if (ship.zip != null && !/^\d{5}(-\d{4})?$/.test(String(ship.zip))) return fail("ship_to.zip must be a US ZIP code");
  return null;
}

function quoteLine(line: Line) {
  const item = prepareCheckoutItem(line.input);
  if ("error" in item) return fail(item.error, item.status);
  const unit = item.quote.goodsCents;
  const shipping = item.quote.shippingCents * line.quantity;
  return {
    work: publicWork(line.work),
    size_id: line.size.id,
    size: item.size.label,
    frame_id: line.frame.id,
    frame: line.frame.label,
    print_ppi: item.crop.ppi,
    quantity: line.quantity,
    currency: "usd",
    unit_price_cents: unit,
    subtotal_cents: unit * line.quantity,
    shipping_cents: shipping,
    tax_cents: null,
    tax: TAX_NOTE,
    total_before_tax_cents: unit * line.quantity + shipping,
    ships_to: SHIPS_TO,
  };
}

/** A cart line in the site's own cart format (lib/cart.ts), for the in-page WebMCP add_to_cart tool. */
export function cartItemDraft(args: Args) {
  const line = orderLine(args);
  if ("error" in line) return line;
  const item = prepareCheckoutItem(line.input);
  if ("error" in item) return fail(item.error, item.status);
  const quote = quoteLine(line);
  if ("error" in quote) return quote;
  return {
    draft: {
      workId: line.work.id,
      title: line.work.title,
      preview: line.work.thumb,
      pixels: line.work.pixels,
      series: line.work.series,
      sizeId: line.size.id,
      ...(line.quantity > 1 ? { quantity: line.quantity } : {}),
      matId: line.input.matId,
      frameId: line.frame.id,
      frameLabel: line.frame.label,
      crop: item.crop,
    },
    quote,
  };
}

export function quoteOrder(args: Args) {
  const shipFail = shipToCheck(args.ship_to);
  if (shipFail) return shipFail;
  const line = orderLine(args);
  if ("error" in line) return line;
  const quote = quoteLine(line);
  return "error" in quote ? quote : { ...quote, policies: policySummary() };
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,24}$/;

/** In-memory limits on the single checkout process. Sessions cost nothing until paid, but bots should not mint them by the thousand. */
const LIMITS = { perIpWindowMs: 10 * 60_000, perIpWindow: 5, perIpDay: 20, globalHour: 60 };
const created: Array<{ at: number; ip: string }> = [];

function rateLimited(ip: string, now = Date.now()) {
  while (created.length && now - created[0].at > 24 * 60 * 60_000) created.shift();
  const mine = created.filter((entry) => entry.ip === ip);
  if (mine.filter((entry) => now - entry.at < LIMITS.perIpWindowMs).length >= LIMITS.perIpWindow) return true;
  if (mine.length >= LIMITS.perIpDay) return true;
  return created.filter((entry) => now - entry.at < 60 * 60_000).length >= LIMITS.globalHour;
}

export function resetCheckoutLimits() {
  created.length = 0;
}

type CreateSession = typeof createPrintCheckoutSession;

/** `surface` (mcp, a2a, rest) goes into the session metadata so paid orders can be counted by interface. */
export async function createAgentCheckout(args: Args, ip: string, createSession: CreateSession = createPrintCheckoutSession, surface?: string) {
  const line = orderLine(args);
  if ("error" in line) return line;
  let email: string | undefined;
  if (args.email != null) {
    const value = text(args.email, 254);
    if (!value || !EMAIL.test(value)) return fail("email is not a valid address");
    email = value;
  }
  const quote = quoteLine(line);
  if ("error" in quote) return quote;
  if (rateLimited(ip)) return fail("Too many checkouts from here. Try again later.", 429);
  // Hold the slot before the Stripe call so parallel requests cannot slip past the limit.
  const slot = { at: Date.now(), ip };
  created.push(slot);
  const release = () => { const index = created.indexOf(slot); if (index >= 0) created.splice(index, 1); };
  const body = line.quantity === 1 ? line.input : { items: Array.from({ length: line.quantity }, () => line.input) };
  let result: Awaited<ReturnType<CreateSession>>;
  try {
    result = await createSession(body, null, { hosted: true, customerEmail: email, channel: "agent", ...(surface ? { agentSurface: surface } : {}) });
  } catch (error) {
    release();
    throw error;
  }
  if ("error" in result) { release(); return fail(result.error ?? "Checkout is not available", result.status); }
  if (!("url" in result) || !result.url) { release(); return fail("Checkout is not available", 502); }
  return {
    order_ref: result.sessionId,
    checkout_url: result.url,
    expires_at: result.expiresAt ? new Date(result.expiresAt * 1000).toISOString() : null,
    quote,
    policies: policySummary(),
    next: "Give checkout_url to the buyer. They enter the shipping address and pay on Stripe. No card is charged until they do.",
  };
}

export async function orderStatus(args: Args) {
  const ref = text(args.order_ref, 255);
  if (!ref || !/^cs_(live|test)_[A-Za-z0-9]+$/.test(ref)) return fail("order_ref is the order_ref returned by create_checkout");
  const status = await getAgentCheckoutStatus(ref);
  if ("error" in status) return fail(status.error ?? "Unknown order", status.status);
  return {
    order_ref: ref,
    checkout_status: status.checkoutStatus,
    payment_status: status.paymentStatus,
    fulfillment: status.fulfillment,
    estimated_delivery: status.estimatedDelivery,
    amount_total_cents: status.amountTotalCents,
    currency: status.currency,
    expires_at: status.expiresAt ? new Date(status.expiresAt * 1000).toISOString() : null,
    items: status.items,
  };
}
