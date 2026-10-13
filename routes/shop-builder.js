// routes/shop.js  — หน้าสั่งทำช่อดอกไม้ (use case: สั่งทำช่อดอกไม้)
// สมมติฐาน: ใช้ better-sqlite3 + express-session  (ถ้าใช้ sqlite3 แบบ callback ต้องปรับส่วนเรียก db)
//
// ใน server.js:
//   const shopRoutes = require('./routes/shop');
//   app.use(shopRoutes(db));        // db = new Database('flowershop1 (1).db')
//
// เส้นทางที่เพิ่ม:  GET /shop · POST /cart/add · GET /bouquet/edit/:id · POST /bouquet/update/:id

const express = require('express');
const crypto = require('node:crypto');

const MAX_STEMS  = { S: 8, M: 20, L: 40 };   // จำนวนก้านดอกไม้สูงสุดต่อขนาด (ปรับได้)
const PAPER_QTY  = { S: 1, M: 2, L: 3 };     // จำนวนแผ่นกระดาษห่อต่อขนาด (ตามเทมเพลตของร้าน)
const DECOR_MAX  = { 'ริบบิ้น': 3, 'โบว์': 3, 'ผีเสื้อ': 6 };
const MAX_QTY    = 10;                       // จำนวนช่อต่อรายการ
const SERVICE_FEES = { S: 100, M: 200, L: 350 };

module.exports = function (db) {
  const router = express.Router();
  router.use(express.json());

  /* ---------- helpers ---------- */
  const today = () => {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  };
  const rid = (prefix, table, column) => {
    let id;
    do {
      id = `${prefix}-${today()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    } while (db.prepare(`SELECT 1 FROM ${table} WHERE ${column} = ?`).get(id));
    return id;
  };
  const kindOf = (it) => it.item_ID[0] === 'F' ? 'flower'
    : it.item_type === 'กระดาษ' ? 'paper'
    : it.item_type === 'การ์ด' ? 'card' : 'decor';

  function getCartId(req, create) {
    let id = req.session.cartId;
    if (id && db.prepare('SELECT 1 FROM cart WHERE cart_ID=?').get(id)) return id;
    if (!create) return null;
    id = crypto.randomUUID();
    db.prepare('INSERT INTO cart (cart_ID, created_at) VALUES (?,?)').run(id, new Date().toISOString());
    req.session.cartId = id;
    return id;
  }
  function cartCount(req) {
    const id = req.session.cartId;
    if (!id) return 0;
    return db.prepare('SELECT COALESCE(SUM(quantity),0) n FROM cart_items WHERE cart_ID=?').get(id).n;
  }

  function loadCatalog() {
    const items = db.prepare(`SELECT item_ID, item_name, item_type, item_unit_price, quantity_in_stock
                              FROM items ORDER BY item_ID`).all()
      .map((r) => ({ id: r.item_ID, name: r.item_name, type: r.item_type,
                     price: r.item_unit_price, stock: r.quantity_in_stock, kind: kindOf(r) }));
    const tplItems = db.prepare('SELECT template_ID, item_ID, quantity FROM template_items').all();
    const templates = db.prepare('SELECT * FROM bouquet_templates ORDER BY template_ID').all().map((t) => {
      const m = /^(.*?)\s*\(Size ([SML])\)\s*$/.exec(t.template_name);
      const its = {};
      tplItems.filter((x) => x.template_ID === t.template_ID).forEach((x) => (its[x.item_ID] = x.quantity));
      return { id: t.template_ID, base: m ? m[1] : t.template_name, size: m ? m[2] : t.template_ID.slice(-1),
               category: t.template_category, desc: t.description || '', items: its };
    });
    return { items, templates };
  }

  function render(req, res, initial, editId) {
    const { items, templates } = loadCatalog();
    res.render('shop', {
      boot: { items, templates, maxStems: MAX_STEMS, paperQty: PAPER_QTY, decorMax: DECOR_MAX,
              serviceFees: SERVICE_FEES,
              maxQty: MAX_QTY, initial: initial || null, editId: editId || null },
      cartCount: cartCount(req),
    });
  }

  /* ตรวจและคำนวณราคาฝั่ง server เสมอ (ไม่เชื่อราคาจาก browser) */
  function build(body) {
    const size = body.size;
    if (!MAX_STEMS[size]) throw new Error('ขนาดช่อไม่ถูกต้อง');
    const qty = parseInt(body.qty, 10);
    if (!(qty >= 1 && qty <= MAX_QTY)) throw new Error('จำนวนช่อไม่ถูกต้อง');

    const catalog = new Map(db.prepare('SELECT * FROM items').all().map((r) => [r.item_ID, r]));
    const want = new Map();
    for (const x of Array.isArray(body.items) ? body.items : []) {
      const q = parseInt(x.qty, 10);
      if (!catalog.has(x.id) || !(q > 0)) continue;
      want.set(x.id, (want.get(x.id) || 0) + q);
    }

    let stems = 0, papers = 0, cards = 0;
    const perDecor = {};
    const rows = [];
    for (const [id, q0] of want) {
      const it = catalog.get(id), kind = kindOf(it);
      let q = q0;
      if (kind === 'flower') stems += q;
      if (kind === 'paper') { papers++; q = PAPER_QTY[size]; }
      if (kind === 'card')  { cards++;  q = 1; }
      if (kind === 'decor') {
        perDecor[it.item_type] = (perDecor[it.item_type] || 0) + q;
        if (perDecor[it.item_type] > DECOR_MAX[it.item_type]) throw new Error(`เพิ่ม${it.item_type}ได้ไม่เกิน ${DECOR_MAX[it.item_type]} ชิ้น`);
      }
      if (q > it.quantity_in_stock) throw new Error(`${it.item_name} เหลือในสต็อกไม่พอ`);
      rows.push({ item_ID: id, quantity: q, price: it.item_unit_price });
    }
    if (stems < 1) throw new Error('กรุณาเลือกดอกไม้อย่างน้อย 1 ก้าน');
    if (stems > MAX_STEMS[size]) throw new Error(`ช่อขนาด ${size} ใส่ดอกไม้ได้ไม่เกิน ${MAX_STEMS[size]} ก้าน`);
    if (papers !== 1) throw new Error('กรุณาเลือกกระดาษห่อ 1 แบบ');
    if (cards > 1) throw new Error('เลือกการ์ดได้ 1 ใบ');

    const unit = rows.reduce((a, r) => a + r.price * r.quantity, 0);
    const serviceFee = SERVICE_FEES[size];
    const cardMessage = cards ? String(body.cardMessage || '').trim().slice(0, 120) : '';
    const note = String(body.note || '').trim().slice(0, 200);
    const name = String(body.name || '').trim().slice(0, 40);

    // เก็บ template_ID เฉพาะเมื่อรายการตรงกับเทมเพลตทุกอย่าง
    let templateId = null;
    if (body.templateId) {
      const t = db.prepare('SELECT item_ID, quantity FROM template_items WHERE template_ID=?').all(body.templateId);
      const m = new Map(rows.map((r) => [r.item_ID, r.quantity]));
      if (t.length && t.length === rows.length && t.every((x) => m.get(x.item_ID) === x.quantity)) templateId = body.templateId;
    }
    return { size, qty, rows, unit, serviceFee, cardMessage, note, name, templateId };
  }

  const writeItems = (bid, rows) => {
    db.prepare('DELETE FROM bouquet_items WHERE bouquet_ID=?').run(bid);
    const ins = db.prepare('INSERT INTO bouquet_items (bouquet_ID, item_ID, quantity) VALUES (?,?,?)');
    rows.forEach((r) => ins.run(bid, r.item_ID, r.quantity));
  };

  /* ---------- routes ---------- */
  router.get('/', (req, res) => {
    if (req.query.order_id) {
      return res.redirect(`/check-order-status?order_id=${encodeURIComponent(String(req.query.order_id))}`);
    }
    if (['florist', 'counter'].includes(req.query.role)) {
      return res.redirect(`/employee/${req.query.role}`);
    }
    return res.render('customer-home');
  });
  router.get('/shop', (req, res) => render(req, res));

  router.post('/cart/add', (req, res) => {
    try {
      const b = build(req.body);
      const cartId = getCartId(req, true);
      const bid = rid('BQT', 'bouquets', 'bouquet_ID');
      const tx = db.transaction(() => {
        db.prepare(`INSERT INTO bouquets
                    (bouquet_ID, template_ID, bouquet_name, size, service_fee, card_message, note_text)
                    VALUES (?,?,?,?,?,?,?)`)
          .run(bid, b.templateId, b.name || null, b.size, b.serviceFee, b.cardMessage || null, b.note || null);
        writeItems(bid, b.rows);
        db.prepare('INSERT INTO cart_items (cart_ID, bouquet_ID, quantity, price_per_unit) VALUES (?,?,?,?)')
          .run(cartId, bid, b.qty, b.unit);
      });
      tx();
      res.json({ ok: true, redirect: '/cart' });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  router.get('/bouquet/edit/:id', (req, res) => {
    const cartId = getCartId(req, false);
    const bq = cartId && db.prepare(`SELECT b.*, ci.quantity AS cart_qty FROM bouquets b
                 JOIN cart_items ci ON ci.bouquet_ID=b.bouquet_ID
                 WHERE b.bouquet_ID=? AND ci.cart_ID=?`).get(req.params.id, cartId);
    if (!bq) return res.redirect('/cart');

    const { items, templates } = loadCatalog();
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    const initial = { size: bq.size, base: null, flowers: {}, paper: null, decor: {}, card: null,
                      cardMsg: bq.card_message || '', name: bq.bouquet_name || '', note: bq.note_text || '', qty: bq.cart_qty };
    if (bq.template_ID) { const t = templates.find((x) => x.id === bq.template_ID); if (t) initial.base = t.base; }
    db.prepare('SELECT item_ID, quantity FROM bouquet_items WHERE bouquet_ID=?').all(bq.bouquet_ID).forEach((r) => {
      const it = byId[r.item_ID]; if (!it) return;
      if (it.kind === 'flower') initial.flowers[it.id] = r.quantity;
      else if (it.kind === 'paper') initial.paper = it.id;
      else if (it.kind === 'card') initial.card = it.id;
      else initial.decor[it.type] = { id: it.id, qty: r.quantity };
    });
    render(req, res, initial, bq.bouquet_ID);
  });

  router.post('/bouquet/update/:id', (req, res) => {
    try {
      const cartId = getCartId(req, false);
      const own = cartId && db.prepare('SELECT 1 FROM cart_items WHERE cart_ID=? AND bouquet_ID=?').get(cartId, req.params.id);
      if (!own) throw new Error('ไม่พบช่อดอกไม้นี้ในตะกร้า');
      const b = build(req.body);
      db.transaction(() => {
        db.prepare(`UPDATE bouquets SET template_ID=?, bouquet_name=?, size=?, service_fee=?, card_message=?, note_text=? WHERE bouquet_ID=?`)
          .run(b.templateId, b.name || null, b.size, b.serviceFee, b.cardMessage || null, b.note || null, req.params.id);
        writeItems(req.params.id, b.rows);
        db.prepare('UPDATE cart_items SET quantity=?, price_per_unit=? WHERE cart_ID=? AND bouquet_ID=?')
          .run(b.qty, b.unit, cartId, req.params.id);
      })();
      res.json({ ok: true, redirect: '/cart' });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  return router;
};
