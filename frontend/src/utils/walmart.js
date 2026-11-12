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
