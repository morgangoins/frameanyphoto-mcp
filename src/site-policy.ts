/**
 * Store policies exactly as the site states them (home promises strip).
 * Structured data reads these too, so the markup never claims more than the page.
 */
export const SHIPPING_COUNTRY = "US";
// The operational promise (checkout delivery estimate and order emails use the same window).
export const SHIPPING_MIN_DAYS = 14;
export const SHIPPING_MAX_DAYS = 21;
export const RETURN_DAYS = 30;
export const SUPPORT_PHONE = "916-704-8543";
export const SUPPORT_PHONE_E164 = "+19167048543";
export const SUPPORT_EMAIL = "ceo@frameanyphoto.com";
// Returns: the buyer pays return shipping, by mail; custom/upload prints are returnable on the same window.
export const RETURN_SHIPPING_PAID_BY = "customer";
export const CUSTOM_PRINTS_RETURNABLE = true;
