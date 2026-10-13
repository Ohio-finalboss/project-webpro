const crypto = require('node:crypto');
const express = require('express');

module.exports = function createOrderFlowRouter(db, publishUpdate = () => {}) {
  const router = express.Router();
  const DELIVERY_FEE = 100;
  const FULFILLMENT = { delivery: 'จัดส่ง', pickup: 'รับที่ร้าน' };

  function pad(number) { return String(number).padStart(2, '0'); }

  function todayStr() {
    const date = new Date();
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function nowStr() { return new Date().toISOString(); }

  function clean(value, maxLength = 500) {
    return String(value == null ? '' : value).trim().slice(0, maxLength);
  }

  function datePart() { return todayStr().replaceAll('-', ''); }

  function uniqueCode(prefix, table, column) {
    let value;
    do {
      value = `${prefix}-${datePart()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    } while (db.prepare(`SELECT 1 FROM ${table} WHERE ${column} = ?`).get(value));
    return value;
  }

  function nextReceiptNumber() {
    const year = String(new Date().getFullYear());
    const row = db.prepare(`
      SELECT MAX(CAST(substr(receipt_number, 11) AS INTEGER)) AS last_number
      FROM payments WHERE receipt_number LIKE ?
    `).get(`RCPT-${year}-%`);
    return `RCPT-${year}-${String(Number(row.last_number || 0) + 1).padStart(6, '0')}`;
  }

  function getCartId(req, create = true) {
    if (req.session.cartId) {
      const existing = db.prepare('SELECT cart_ID FROM cart WHERE cart_ID = ?').get(req.session.cartId);
      if (existing) return existing.cart_ID;
    }
    if (!create) return null;
    const cartId = crypto.randomUUID();
    db.prepare('INSERT INTO cart (cart_ID, created_at) VALUES (?, ?)').run(cartId, nowStr());
    req.session.cartId = cartId;
    return cartId;
  }

  function loadCartItems(cartId) {
    if (!cartId) return [];
    return db.prepare(`
      SELECT ci.bouquet_ID, ci.quantity, ci.price_per_unit,
             b.bouquet_name, b.size, b.service_fee, b.card_message, b.note_text
      FROM cart_items AS ci JOIN bouquets AS b ON b.bouquet_ID = ci.bouquet_ID
      WHERE ci.cart_ID = ? ORDER BY b.bouquet_ID
    `).all(cartId);
  }

  function getBouquetComponents(bouquetId) {
    return db.prepare(`
      SELECT i.item_name, bi.quantity
      FROM bouquet_items AS bi JOIN items AS i ON i.item_ID = bi.item_ID
      WHERE bi.bouquet_ID = ? ORDER BY i.item_ID
    `).all(bouquetId);
  }

  function calcSummary(items, fulfillment) {
    const subtotal = items.reduce((sum, item) => sum + (Number(item.price_per_unit || 0) + Number(item.service_fee || 0)) * Number(item.quantity || 0), 0);
    const deliveryFee = fulfillment === 'delivery' ? DELIVERY_FEE : 0;
    return { subtotal, deliveryFee, total: subtotal + deliveryFee };
  }

  function validateInform(body) {
    const data = {
      customerName: clean(body.customerName, 100),
      phone: clean(body.phone, 20),
      fulfillment: body.fulfillment === 'pickup' ? 'pickup' : 'delivery',
      recipientName: clean(body.recipientName, 100),
      address: clean(body.address, 300),
      date: clean(body.date, 10),
      time: clean(body.time, 5),
    };
    const phoneDigits = data.phone.replace(/[\s-]/g, '');
    let error = null;

    if (!data.customerName) error = 'กรุณากรอกชื่อผู้สั่งซื้อ';
    else if (!/^0\d{8,9}$/.test(phoneDigits)) error = 'กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง เช่น 0812345678';
    else if (data.fulfillment === 'delivery' && !data.recipientName) error = 'กรุณากรอกชื่อผู้รับ';
    else if (data.fulfillment === 'delivery' && !data.address) error = 'กรุณากรอกที่อยู่จัดส่ง';
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) error = 'กรุณาเลือกวันที่ต้องการรับสินค้า';
    else if (!/^\d{2}:\d{2}$/.test(data.time)) error = 'กรุณาเลือกเวลาที่ต้องการรับสินค้า';
    else {
      const when = new Date(`${data.date}T${data.time}:00`);
      if (Number.isNaN(when.getTime()) || when.getTime() < Date.now()) error = 'วันและเวลาที่เลือกต้องไม่ย้อนหลัง';
    }

    data.phone = phoneDigits;
    if (data.fulfillment === 'pickup') {
      data.recipientName = '';
      data.address = '';
    }
    return { data, error };
  }

  const removeFromCart = db.transaction((cartId, bouquetId) => {
    db.prepare('DELETE FROM cart_items WHERE cart_ID = ? AND bouquet_ID = ?').run(cartId, bouquetId);
    const used = db.prepare(`
      SELECT 1 FROM cart_items WHERE bouquet_ID = ?
      UNION SELECT 1 FROM order_details WHERE bouquet_ID = ?
    `).get(bouquetId, bouquetId);
    if (!used) {
      db.prepare('DELETE FROM bouquet_items WHERE bouquet_ID = ?').run(bouquetId);
      db.prepare('DELETE FROM bouquets WHERE bouquet_ID = ?').run(bouquetId);
    }
  });

  router.get('/cart', (req, res, next) => {
    try {
      const cartId = getCartId(req);
      const items = loadCartItems(cartId);
      return res.render('cart', { items, summary: calcSummary(items, null) });
    } catch (error) { return next(error); }
  });

  router.post('/cart/update/:bouquetId', (req, res, next) => {
    try {
      const cartId = getCartId(req);
      const quantity = Number.parseInt(req.body.quantity, 10);
      if (quantity > 0) {
        db.prepare('UPDATE cart_items SET quantity = ? WHERE cart_ID = ? AND bouquet_ID = ?')
          .run(quantity, cartId, req.params.bouquetId);
      } else removeFromCart(cartId, req.params.bouquetId);
      return res.redirect('/cart');
    } catch (error) { return next(error); }
  });

  router.post('/cart/delete/:bouquetId', (req, res, next) => {
    try {
      removeFromCart(getCartId(req), req.params.bouquetId);
      return res.redirect('/cart');
    } catch (error) { return next(error); }
  });

  router.get('/inform', (req, res, next) => {
    try {
      const items = loadCartItems(getCartId(req));
      if (!items.length) return res.redirect('/cart');
      return res.render('inform', { form: req.session.orderInfo || {}, error: null, today: todayStr() });
    } catch (error) { return next(error); }
  });

  router.post('/inform', (req, res, next) => {
    try {
      if (!loadCartItems(getCartId(req)).length) return res.redirect('/cart');
      const result = validateInform(req.body);
      if (result.error) {
        return res.status(400).render('inform', { form: result.data, error: result.error, today: todayStr() });
      }
      req.session.orderInfo = result.data;
      return res.redirect('/check');
    } catch (error) { return next(error); }
  });

  router.get('/check', (req, res, next) => {
    try {
      const rows = loadCartItems(getCartId(req));
      const info = req.session.orderInfo;
      if (!rows.length) return res.redirect('/cart');
      if (!info) return res.redirect('/inform');
      const items = rows.map((item) => ({ ...item, components: getBouquetComponents(item.bouquet_ID) }));
      const fulfillmentLabel = info.fulfillment === 'delivery' ? 'จัดส่งตามที่อยู่' : 'รับที่หน้าร้าน';
      return res.render('check', { info, items, summary: calcSummary(rows, info.fulfillment), fulfillmentLabel });
    } catch (error) { return next(error); }
  });

  const createOrder = db.transaction((cartId, info, items, summary) => {
    const orderId = uniqueCode('ORD', 'orders', 'order_ID');
    const paymentId = uniqueCode('PAY', 'payments', 'payment_ID');
    const receiptNumber = nextReceiptNumber();
    db.prepare(`
      INSERT INTO orders
        (order_ID, emp_ID, order_status, order_date, customer_name,
         customer_phone_number, fulfillment_type, recipient_name,
         delivery_address, pickup_deliv_date, delivery_fee, total_amount)
      VALUES (?, NULL, 'รอจัด', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      orderId, nowStr(), info.customerName, info.phone,
      FULFILLMENT[info.fulfillment],
      info.fulfillment === 'delivery' ? info.recipientName : null,
      info.fulfillment === 'delivery' ? info.address : null,
      `${info.date} ${info.time}`,
      summary.deliveryFee, summary.total,
    );

    const insertDetail = db.prepare(`
      INSERT INTO order_details (order_ID, bouquet_ID, quantity, price_per_unit)
      VALUES (?, ?, ?, ?)
    `);
    items.forEach((item) => insertDetail.run(orderId, item.bouquet_ID, item.quantity, item.price_per_unit));

    db.prepare(`
      INSERT INTO payments
        (payment_ID, order_ID, amount, payment_status, payment_method, payment_date, receipt_number)
      VALUES (?, ?, ?, 'รอการชำระ', 'QR Payment', ?, ?)
    `).run(paymentId, orderId, summary.total, nowStr(), receiptNumber);

    db.prepare('DELETE FROM cart_items WHERE cart_ID = ?').run(cartId);
    db.prepare('DELETE FROM cart WHERE cart_ID = ?').run(cartId);
    return orderId;
  });

  router.post('/check/confirm', (req, res, next) => {
    try {
      const cartId = getCartId(req);
      const info = req.session.orderInfo;
      const items = loadCartItems(cartId);
      if (!items.length) return res.redirect('/cart');
      if (!info) return res.redirect('/inform');
      const orderId = createOrder(cartId, info, items, calcSummary(items, info.fulfillment));
      publishUpdate();
      delete req.session.cartId;
      delete req.session.orderInfo;
      return res.redirect(`/payment/${encodeURIComponent(orderId)}`);
    } catch (error) { return next(error); }
  });

  router.get('/payment/:id', (req, res, next) => {
    try {
      const order = db.prepare(`
        SELECT o.order_ID, o.customer_name, o.order_status, o.total_amount,
               p.payment_status, p.payment_method, p.receipt_number
        FROM orders AS o LEFT JOIN payments AS p ON p.order_ID = o.order_ID
        WHERE o.order_ID = ? ORDER BY p.rowid DESC LIMIT 1
      `).get(req.params.id);
      if (!order) return res.redirect('/cart');
      if (order.payment_status === 'ยกเลิก' || order.order_status === 'ยกเลิก') {
        return res.redirect(`/check-order-status?order_id=${encodeURIComponent(order.order_ID)}`);
      }
      if (order.payment_status !== 'รอการชำระ') {
        return res.redirect(`/order-success/${encodeURIComponent(order.order_ID)}`);
      }
      return res.render('payment', { order, shopName: 'Flower Shop' });
    } catch (error) { return next(error); }
  });

  router.post('/payment/confirm/:id', (req, res, next) => {
    try {
      const order = db.prepare(`
        SELECT o.order_ID, o.order_status, p.payment_status
        FROM orders AS o JOIN payments AS p ON p.order_ID = o.order_ID
        WHERE o.order_ID = ? ORDER BY p.rowid DESC LIMIT 1
      `).get(req.params.id);
      if (!order) return res.redirect('/cart');
      if (order.payment_status === 'ยกเลิก' || order.order_status === 'ยกเลิก') {
        return res.redirect(`/check-order-status?order_id=${encodeURIComponent(order.order_ID)}`);
      }
      const result = db.prepare(`
        UPDATE payments SET payment_status = 'แจ้งชำระเงินแล้ว'
        WHERE order_ID = ? AND payment_status = 'รอการชำระ'
      `).run(req.params.id);
      if (result.changes) publishUpdate();
      return res.redirect(`/order-success/${encodeURIComponent(req.params.id)}`);
    } catch (error) { return next(error); }
  });

  router.post('/payment/cancel/:id', (req, res, next) => {
    try {
      const order = db.prepare(`
        SELECT o.order_ID, o.order_status, p.payment_status
        FROM orders AS o JOIN payments AS p ON p.payment_ID = (
          SELECT p2.payment_ID FROM payments AS p2
          WHERE p2.order_ID = o.order_ID ORDER BY p2.rowid DESC LIMIT 1
        )
        WHERE o.order_ID = ?
      `).get(req.params.id);
      if (!order) return res.redirect('/cart');

      const cancelOrder = db.transaction(() => {
        const current = db.prepare(`
          SELECT o.order_status, p.payment_ID, p.payment_status
          FROM orders AS o JOIN payments AS p ON p.payment_ID = (
            SELECT p2.payment_ID FROM payments AS p2
            WHERE p2.order_ID = o.order_ID ORDER BY p2.rowid DESC LIMIT 1
          )
          WHERE o.order_ID = ?
        `).get(order.order_ID);
        if (!current || current.payment_status !== 'รอการชำระ' || current.order_status === 'ยกเลิก') return false;
        db.prepare("UPDATE orders SET order_status = 'ยกเลิก' WHERE order_ID = ?").run(order.order_ID);
        db.prepare("UPDATE payments SET payment_status = 'ยกเลิก' WHERE payment_ID = ? AND payment_status = 'รอการชำระ'").run(current.payment_ID);
        return true;
      });

      if (cancelOrder()) publishUpdate();
      return res.redirect(`/check-order-status?order_id=${encodeURIComponent(order.order_ID)}`);
    } catch (error) { return next(error); }
  });

  router.get('/payment/notice/:id', (req, res) => {
    return res.redirect(`/order-success/${encodeURIComponent(req.params.id)}`);
  });

  return router;
};
