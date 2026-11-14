// Links into walmart.com for the shopping list. There's no public Walmart API for consumer
// carts or lists; the add-to-cart address below is Walmart's affiliate cart link, which adds
// the items to whatever cart the browser is signed in to and stops at cart review.

export function walmartSearchUrl(name) {
  return `https://www.walmart.com/search?q=${encodeURIComponent(name)}`
}

export function walmartProductUrl(itemId) {
  return `https://www.walmart.com/ip/${encodeURIComponent(itemId)}`
}

// One of each product; quantities are adjusted in the cart.
export function walmartCartUrl(itemIds) {
  const unique = [...new Set(itemIds)]
  return `https://affil.walmart.com/cart/addToCart?items=${unique.map((id) => `${id}|1`).join(',')}`
}

// --- Picking a product in a Walmart popup -------------------------------------------------
// Walmart can't be shown inside Mise (it forbids framing) and Mise can't read a cross-origin
// window's address. So Mise opens Walmart in a popup, and something running on the Walmart
// page (the userscript in public/mise-walmart.user.js, or the bookmarklet below) posts this
// message back to `window.opener` from a product page. Keep the two senders in sync with it.
export const WALMART_PICK_MESSAGE = 'mise:walmart-item'

const WALMART_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*walmart\.com$/i

export function isWalmartOrigin(origin) {
  return WALMART_ORIGIN.test(origin ?? '')
}

// Reuses one named popup, so picking for a second ingredient replaces the first window.
export function openWalmartPicker(url) {
  return window.open(url, 'mise-walmart', 'popup,width=1100,height=850')
}

// "Great Value Whole Milk, Gallon - Walmart.com" → "Great Value Whole Milk, Gallon"
export function productTitle(pageTitle) {
  return String(pageTitle ?? '').replace(/\s*[-|]\s*Walmart\.com\s*$/i, '').trim()
}

export const SEND_TO_MISE_BOOKMARKLET = `javascript:(()=>{const m=location.pathname.match(/\\/ip\\/(?:[^/]+\\/)?(\\d{5,15})/);if(!m){alert('Open a Walmart product page first.');return}if(!window.opener||window.opener.closed){alert('Open this window from Search in the Mise shopping list first.');return}window.opener.postMessage({type:'${WALMART_PICK_MESSAGE}',itemId:m[1],url:location.href,title:document.title},'*')})()`

export const USERSCRIPT_PATH = '/mise-walmart.user.js'
