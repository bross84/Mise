// ==UserScript==
// @name         Mise: Send to Mise
// @namespace    mise
// @version      1.2
// @description  On a Walmart product page opened from Mise's shopping list, adds a "Send to Mise" button that links the product to the ingredient.
// @match        https://www.walmart.com/*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

// Sends the same message as the bookmarklet in frontend/src/utils/walmart.js; keep them in sync.
// It only shows in a window Mise opened (one with an opener), so normal Walmart shopping is
// untouched, and it reads the item number from the address rather than the page layout.
// Keep this file plain ASCII: it's served without a charset, so script managers may read it as
// Latin-1 and garble anything else.
// Walmart moves between pages without reloading, so the address is re-checked on a timer.
(function () {
  'use strict'

  const PRODUCT_PATH = /^\/ip\/(?:[^/]+\/)?(\d{5,15})\/?$/
  let button = null
  let lastPath = null

  function itemIdFromPath() {
    const match = location.pathname.match(PRODUCT_PATH)
    return match ? match[1] : null
  }

  function openerAlive() {
    try {
      return Boolean(window.opener) && !window.opener.closed
    } catch {
      return false
    }
  }

  function makeButton() {
    const el = document.createElement('button')
    el.type = 'button'
    el.textContent = 'Send to Mise'
    Object.assign(el.style, {
      position: 'fixed',
      right: '24px',
      bottom: '24px',
      zIndex: '2147483647',
      padding: '14px 22px',
      border: 'none',
      borderRadius: '6px',
      background: '#CC3F0C',
      color: '#191919',
      font: '600 16px/1 system-ui, sans-serif',
      boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
      cursor: 'pointer',
    })
    el.addEventListener('click', () => {
      const itemId = itemIdFromPath()
      if (!itemId || !openerAlive()) {
        el.textContent = 'Mise window is closed'
        return
      }
      window.opener.postMessage(
        { type: 'mise:walmart-item', itemId, url: location.href, title: document.title },
        '*',
      )
      // No confirmation: Mise closes this window as soon as it has saved the link.
    })
    return el
  }

  function update() {
    if (location.pathname === lastPath) return
    lastPath = location.pathname
    const show = itemIdFromPath() && openerAlive()
    if (show && !button) {
      button = makeButton()
      document.body.appendChild(button)
    } else if (!show && button) {
      button.remove()
      button = null
    }
  }

  update()
  setInterval(update, 500)
})()
