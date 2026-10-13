const path = require('path');
const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const createShopBuilderRouter = require('./routes/shop-builder');
const createOrderFlowRouter = require('./routes/order-flow');
const createSseHub = require('./lib/sse');

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database(path.join(__dirname, 'db', 'flowershop1 (1).db'));
db.pragma('foreign_keys = ON');
const sseHub = createSseHub();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'flower2-local-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' },
}));
app.use(express.static(path.join(__dirname, 'public')));

app.locals.money0 = (number) => Number(number || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
app.locals.money2 = (number) => Number(number || 0).toLocaleString('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

app.get('/events', sseHub.subscribe);
app.use(createShopBuilderRouter(db));
app.use(createOrderFlowRouter(db, sseHub.publishUpdate));

const STATUS_STEPS = ['รอจัด', 'กำลังจัดช่อ', 'จัดเสร็จแล้ว', 'เสร็จสิ้น'];
const STATUS_CANCELLED = 'ยกเลิก';

function statusInfo(status) {
  const index = STATUS_STEPS.indexOf(status);
  let tone = 'other';
  if (status === STATUS_CANCELLED) tone = 'cancel';
  else if (index === 0) tone = 'wait';
  else if (index === STATUS_STEPS.length - 1) tone = 'done';
  else if (index > 0) tone = 'progress';
  return { index, tone, cancelled: status === STATUS_CANCELLED };
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return value;
  const hasTime = /\d{1,2}:\d{2}/.test(value);
  return date.toLocaleString('th-TH', {
    day: 'numeric', month: 'long', year: 'numeric',
    ...(hasTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }) + (hasTime ? ' น.' : '');
}

function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}

function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}

function latestPaymentJoin() {
  return `
    LEFT JOIN payments AS p ON p.payment_ID = (
      SELECT p2.payment_ID FROM payments AS p2
      WHERE p2.order_ID = o.order_ID
      ORDER BY p2.rowid DESC LIMIT 1
    )
  `;
}

function getOrderDetail(orderId) {
  return get(`
    SELECT o.order_ID, o.emp_ID, o.customer_name, o.customer_phone_number, o.recipient_name,
           o.delivery_address, o.fulfillment_type, o.order_status, o.order_date,
           o.pickup_deliv_date, o.delivery_fee, o.total_amount,
           p.amount, p.payment_status, p.payment_method,
           p.payment_date, p.receipt_number
    FROM orders AS o
    ${latestPaymentJoin()}
    WHERE o.order_ID = ?
  `, [orderId]);
}

// หน้าชำระเงินสำเร็จหลังลูกค้าแจ้งชำระ; พนักงานเคาน์เตอร์ยังต้องยืนยันก่อนออกใบเสร็จ
app.get('/order-success/:order_id', (req, res, next) => {
  try {
    const order = get(`
      SELECT o.order_ID, o.customer_name, o.order_status, o.total_amount,
             p.payment_status, p.payment_method
      FROM orders AS o LEFT JOIN payments AS p ON p.order_ID = o.order_ID
      WHERE o.order_ID = ? ORDER BY p.rowid DESC LIMIT 1
    `, [req.params.order_id]);
    if (!order) return res.redirect('/cart');
    if (order.payment_status === 'ยกเลิก' || order.order_status === 'ยกเลิก') {
      return res.redirect(`/check-order-status?order_id=${encodeURIComponent(order.order_ID)}`);
    }
    if (order.payment_status === 'รอการชำระ') {
      return res.redirect(`/payment/${encodeURIComponent(order.order_ID)}`);
    }
    return res.render('order-success', { order });
  } catch (error) {
    return next(error);
  }
});

function dashboard(req, res, next, role) {
  try {
    const orderCount = get('SELECT COUNT(*) AS count FROM orders').count;
    const waitingOrders = get(`
      SELECT COUNT(*) AS count FROM orders AS o
      WHERE o.order_status IN ('รอจัด', 'กำลังจัดช่อ')
        AND EXISTS (
          SELECT 1 FROM payments AS p
          WHERE p.order_ID = o.order_ID AND p.payment_status = 'ชำระแล้ว'
        )
    `).count;
    const invoiceCount = get("SELECT COUNT(*) AS count FROM payments WHERE payment_status = 'แจ้งชำระเงินแล้ว'").count;
    const recentOrders = all(`
      SELECT order_ID, customer_name, order_status, pickup_deliv_date
      FROM orders
      WHERE order_status NOT IN ('เสร็จสิ้น', 'ยกเลิก')
      ORDER BY order_date DESC
      LIMIT 5
    `);
    const completedOrders = all(`
      SELECT order_ID, customer_name, order_status, pickup_deliv_date
      FROM orders
      WHERE order_status = 'เสร็จสิ้น'
      ORDER BY datetime(order_date) DESC, order_date DESC, order_ID DESC
    `);

    return res.render('home', {
      role,
      stats: { orderCount, waitingOrders, invoiceCount },
      recentOrders,
      completedOrders,
    });
  } catch (error) {
    return next(error);
  }
}

// หน้าตรวจสอบสถานะคำสั่งซื้อแยกจากหน้าแรกของลูกค้า
app.get('/check-order-status', (req, res, next) => {
  const query = String(req.query.order_id || '').trim();
  const view = {
    query, searched: false, error: null, order: null,
    status: null, steps: STATUS_STEPS, formatDate,
  };

  if (query) {
    view.searched = true;
    if (query.length > 30) {
      view.error = 'หมายเลขคำสั่งซื้อยาวเกินไป กรุณาตรวจสอบอีกครั้ง';
    } else {
      view.order = get('SELECT * FROM orders WHERE UPPER(order_ID) = UPPER(?)', [query]);
      if (view.order) view.status = statusInfo(view.order.order_status);
      else view.error = `ไม่พบคำสั่งซื้อหมายเลข "${query}" กรุณาตรวจสอบหมายเลขบนใบเสร็จ`;
    }
  }
  return res.render('check-order-status', view);
});

app.get('/employee/:role', (req, res, next) => {
  if (!['florist', 'counter'].includes(req.params.role)) return res.sendStatus(404);
  return dashboard(req, res, next, req.params.role);
});

app.get('/employee/florist/orders', (req, res, next) => {
  const role = 'florist';

  try {
    const orders = all(`
      SELECT o.order_ID, o.customer_name, o.customer_phone_number,
             o.order_status, o.order_date, o.pickup_deliv_date,
             o.fulfillment_type, p.amount, p.payment_status, p.payment_method,
             p.receipt_number
      FROM orders AS o
      ${latestPaymentJoin()}
      ORDER BY CASE o.order_status
        WHEN 'รอจัด' THEN 1
        WHEN 'กำลังจัดช่อ' THEN 2
        WHEN 'จัดเสร็จแล้ว' THEN 3
        WHEN 'เสร็จสิ้น' THEN 4
        WHEN 'ยกเลิก' THEN 5
        ELSE 6
      END ASC,
      datetime(o.order_date) ASC, o.order_date ASC, o.order_ID ASC
    `);
    return res.render('orders', { role, orders, viewMode: 'all' });
  } catch (error) {
    return next(error);
  }
});

app.get('/employee/florist/progress', (req, res, next) => {
  const role = 'florist';

  try {
    const orders = all(`
      SELECT o.order_ID, o.customer_name, o.customer_phone_number,
             o.order_status, o.order_date, o.pickup_deliv_date,
             o.fulfillment_type, p.amount, p.payment_status, p.payment_method,
             p.receipt_number
      FROM orders AS o
      ${latestPaymentJoin()}
      WHERE o.order_status IN ('รอจัด', 'กำลังจัดช่อ')
        AND p.payment_status = 'ชำระแล้ว'
      ORDER BY datetime(o.order_date) ASC, o.order_date ASC, o.order_ID ASC
    `);
    return res.render('orders', { role, orders, viewMode: 'progress' });
  } catch (error) {
    return next(error);
  }
});

app.get('/employee/:role/orders/:orderId', (req, res, next) => {
  const role = req.params.role;
  if (!['florist', 'counter'].includes(role)) return res.sendStatus(404);
  try {
    const order = getOrderDetail(req.params.orderId);
    if (!order) return res.status(404).render('not-found', { role });

    const bouquets = all(`
      SELECT od.rowid AS order_detail_ID, od.quantity AS bouquet_quantity,
             od.price_per_unit, b.service_fee, b.bouquet_ID,
             COALESCE(b.bouquet_name, bt.template_name, 'ช่อดอกไม้') AS bouquet_name,
             b.size, NULL AS card_color, b.card_message, b.note_text
      FROM order_details AS od
      LEFT JOIN bouquets AS b ON b.bouquet_ID = od.bouquet_ID
      LEFT JOIN bouquet_templates AS bt ON bt.template_ID = b.template_ID
      WHERE od.order_ID = ?
      ORDER BY od.rowid ASC
    `, [order.order_ID]);

    for (const bouquet of bouquets) {
      bouquet.items = bouquet.bouquet_ID
        ? all(`
            SELECT i.item_name, i.item_type, bi.quantity
            FROM bouquet_items AS bi
            LEFT JOIN items AS i ON i.item_ID = bi.item_ID
            WHERE bi.bouquet_ID = ?
            UNION ALL
            SELECT i.item_name, i.item_type, ti.quantity
            FROM template_items AS ti
            JOIN items AS i ON i.item_ID = ti.item_ID
            WHERE ti.template_ID = (SELECT template_ID FROM bouquets WHERE bouquet_ID = ?)
              AND NOT EXISTS (SELECT 1 FROM bouquet_items WHERE bouquet_ID = ?)
            ORDER BY i.item_name ASC
          `, [bouquet.bouquet_ID, bouquet.bouquet_ID, bouquet.bouquet_ID])
        : [];
    }

    const floristEmployees = role === 'florist'
      ? all(`
          SELECT emp_ID, emp_firstname, emp_lastname
          FROM employees
          WHERE emp_role = 'พนักงานจัดดอกไม้'
          ORDER BY emp_firstname ASC, emp_lastname ASC, emp_ID ASC
        `)
      : [];

    return res.render('order-detail', { role, order, bouquets, floristEmployees });
  } catch (error) {
    return next(error);
  }
});

app.post('/employee/florist/orders/:orderId/status', (req, res, next) => {
  const role = 'florist';
  const allowedStatuses = ['กำลังจัดช่อ', 'จัดเสร็จแล้ว'];
  if (req.body.role !== 'florist') return res.sendStatus(403);
  if (!allowedStatuses.includes(req.body.status)) return res.status(400).send('สถานะคำสั่งซื้อไม่ถูกต้อง');

  try {
    const order = get('SELECT order_status, emp_ID FROM orders WHERE order_ID = ?', [req.params.orderId]);
    if (!order) return res.status(404).render('not-found', { role });
    const nextStatuses = {
      รอจัด: ['กำลังจัดช่อ'],
      กำลังจัดช่อ: ['จัดเสร็จแล้ว'],
    };
    if (!(nextStatuses[order.order_status] || []).includes(req.body.status)) {
      return res.status(409).send('สถานะออเดอร์เปลี่ยนไปแล้ว กรุณาโหลดหน้าอีกครั้ง');
    }
    if (req.body.status === 'กำลังจัดช่อ') {
      const employeeId = String(req.body.emp_ID || '').trim();
      if (!employeeId) return res.status(400).send('กรุณาเลือกพนักงานจัดดอกไม้');
      const employee = get(
        "SELECT emp_ID FROM employees WHERE emp_ID = ? AND emp_role = 'พนักงานจัดดอกไม้'",
        [employeeId],
      );
      if (!employee) return res.status(400).send('เลือกได้เฉพาะพนักงานจัดดอกไม้');
      const result = run(
        'UPDATE orders SET order_status = ?, emp_ID = ? WHERE order_ID = ? AND order_status = ?',
        [req.body.status, employee.emp_ID, req.params.orderId, order.order_status],
      );
      if (!result.changes) return res.status(409).send('สถานะออเดอร์เปลี่ยนไปแล้ว กรุณาโหลดหน้าอีกครั้ง');
      sseHub.publishUpdate();
      return res.redirect(`/employee/florist/orders/${encodeURIComponent(req.params.orderId)}`);
    }

    const result = run(
      'UPDATE orders SET order_status = ? WHERE order_ID = ? AND order_status = ?',
      [req.body.status, req.params.orderId, order.order_status],
    );
    if (!result.changes) return res.status(404).render('not-found', { role });
    sseHub.publishUpdate();
    return res.redirect(`/employee/florist/orders/${encodeURIComponent(req.params.orderId)}`);
  } catch (error) {
    return next(error);
  }
});

app.get('/employee/counter/orders', (req, res, next) => {
  try {
    const orders = all(`
      SELECT o.order_ID, o.customer_name, o.customer_phone_number,
             o.order_status, o.order_date, o.pickup_deliv_date,
             o.fulfillment_type, p.amount, p.payment_status, p.payment_method,
             p.receipt_number
      FROM orders AS o
      ${latestPaymentJoin()}
      ORDER BY CASE o.order_status
        WHEN 'รอจัด' THEN 1
        WHEN 'กำลังจัดช่อ' THEN 2
        WHEN 'จัดเสร็จแล้ว' THEN 3
        WHEN 'เสร็จสิ้น' THEN 4
        WHEN 'ยกเลิก' THEN 5
        ELSE 6
      END ASC,
      datetime(o.order_date) ASC, o.order_date ASC, o.order_ID ASC
    `);
    return res.render('counter-home', { mode: 'all', orders });
  } catch (error) {
    return next(error);
  }
});

app.get('/employee/counter/tracking', (req, res, next) => {
  try {
    const orders = all(`
      SELECT o.order_ID, o.customer_name, o.customer_phone_number,
             o.order_status, o.order_date, o.pickup_deliv_date,
             o.fulfillment_type, p.amount, p.payment_status, p.payment_method,
             p.receipt_number
      FROM orders AS o
      ${latestPaymentJoin()}
      WHERE o.order_status NOT IN ('เสร็จสิ้น', 'ยกเลิก')
      ORDER BY datetime(o.order_date) ASC, o.order_date ASC, o.order_ID ASC
    `);
    return res.render('counter-home', { mode: 'tracking', orders });
  } catch (error) {
    return next(error);
  }
});

app.get('/employee/counter/receipts', (req, res, next) => {
  try {
    const orders = all(`
      SELECT o.order_ID, o.customer_name, o.customer_phone_number,
             o.order_status, o.order_date, o.pickup_deliv_date,
             o.fulfillment_type, p.amount, p.payment_status, p.payment_method,
             p.receipt_number
      FROM orders AS o
      ${latestPaymentJoin()}
      WHERE p.payment_status = 'แจ้งชำระเงินแล้ว'
      ORDER BY datetime(o.order_date) ASC, o.order_date ASC, o.order_ID ASC
    `);
    return res.render('counter-home', { mode: 'receipts', orders });
  } catch (error) {
    return next(error);
  }
});

app.post('/employee/counter/orders/:orderId/payment', (req, res, next) => {
  try {
    const order = get('SELECT order_ID FROM orders WHERE order_ID = ?', [req.params.orderId]);
    if (!order) return res.status(404).render('not-found', { role: 'counter' });
    const payment = get('SELECT payment_status FROM payments WHERE order_ID = ? ORDER BY rowid DESC LIMIT 1', [req.params.orderId]);
    if (!payment) return res.status(404).send('ไม่พบรายการชำระเงิน');
    if (payment.payment_status === 'ชำระแล้ว') {
      return res.redirect(`/employee/counter/receipt/${encodeURIComponent(req.params.orderId)}`);
    }
    if (payment.payment_status !== 'แจ้งชำระเงินแล้ว') {
      return res.status(409).send('ลูกค้ายังไม่ได้แจ้งชำระเงิน จึงยังยืนยันและออกใบเสร็จไม่ได้');
    }
    const result = run(`
      UPDATE payments SET payment_status = 'ชำระแล้ว', payment_date = ?,
        receipt_number = COALESCE(receipt_number, ?)
      WHERE order_ID = ? AND payment_status = 'แจ้งชำระเงินแล้ว'
    `, [new Date().toISOString(), `RCPT-${req.params.orderId}`, req.params.orderId]);
    if (!result.changes) return res.status(409).send('สถานะการชำระเงินเปลี่ยนไปแล้ว กรุณาโหลดหน้าใหม่');
    sseHub.publishUpdate();
    return res.redirect(`/employee/counter/receipt/${encodeURIComponent(req.params.orderId)}`);
  } catch (error) {
    return next(error);
  }
});

app.post('/employee/counter/orders/:orderId/status', (req, res, next) => {
  const allowedStatuses = ['กำลังจัดส่ง', 'เสร็จสิ้น'];
  if (!allowedStatuses.includes(req.body.status)) return res.status(400).send('สถานะคำสั่งซื้อไม่ถูกต้อง');

  try {
    const order = get('SELECT order_status, fulfillment_type FROM orders WHERE order_ID = ?', [req.params.orderId]);
    if (!order) return res.status(404).render('not-found', { role: 'counter' });
    const allowedNextStatus = order.fulfillment_type === 'จัดส่ง'
      ? (order.order_status === 'จัดเสร็จแล้ว' ? 'กำลังจัดส่ง' : order.order_status === 'กำลังจัดส่ง' ? 'เสร็จสิ้น' : null)
      : (order.order_status === 'จัดเสร็จแล้ว' ? 'เสร็จสิ้น' : null);
    if (req.body.status !== allowedNextStatus) {
      return res.status(409).send('อัปเดตการส่งมอบได้หลังจัดช่อเสร็จแล้ว');
    }
    const result = run('UPDATE orders SET order_status = ? WHERE order_ID = ?', [req.body.status, req.params.orderId]);
    if (!result.changes) return res.status(404).render('not-found', { role: 'counter' });
    sseHub.publishUpdate();
    return res.redirect(`/employee/counter/orders/${encodeURIComponent(req.params.orderId)}`);
  } catch (error) {
    return next(error);
  }
});

app.get('/employee/counter/receipt/:orderId', (req, res, next) => {
  try {
    const order = get(`
      SELECT o.*, p.amount, p.payment_status, p.payment_method,
             p.payment_date, p.receipt_number
      FROM orders AS o
      ${latestPaymentJoin()}
      WHERE o.order_ID = ?
    `, [req.params.orderId]);
    if (!order) return res.status(404).render('not-found', { role: 'counter' });
    if (order.payment_status !== 'ชำระแล้ว') {
      return res.status(409).render('receipt', { order, bouquets: [], qrUrl: null });
    }
    if (!order.receipt_number) {
      order.receipt_number = `RCPT-${order.order_ID}`;
      run('UPDATE payments SET receipt_number = ? WHERE order_ID = ? AND receipt_number IS NULL', [order.receipt_number, order.order_ID]);
    }

    const bouquets = all(`
      SELECT COALESCE(b.bouquet_name, bt.template_name, 'ช่อดอกไม้') AS bouquet_name,
             b.size, od.quantity, od.price_per_unit, b.service_fee,
             COALESCE((SELECT group_concat(i.item_name || ' × ' || bi.quantity, ', ')
              FROM bouquet_items AS bi JOIN items AS i ON i.item_ID = bi.item_ID
              WHERE bi.bouquet_ID = b.bouquet_ID),
              (SELECT group_concat(i.item_name || ' × ' || ti.quantity, ', ')
               FROM template_items AS ti JOIN items AS i ON i.item_ID = ti.item_ID
               WHERE ti.template_ID = b.template_ID)) AS item_summary
      FROM order_details AS od
      LEFT JOIN bouquets AS b ON b.bouquet_ID = od.bouquet_ID
      LEFT JOIN bouquet_templates AS bt ON bt.template_ID = b.template_ID
      WHERE od.order_ID = ?
      ORDER BY od.rowid ASC
    `, [order.order_ID]);
    const qrUrl = `/check-order-status/qr/${encodeURIComponent(order.order_ID)}`;
    return res.render('receipt', { order, bouquets, qrUrl });
  } catch (error) {
    return next(error);
  }
});

app.get('/check-order-status/qr/:orderId', async (req, res, next) => {
  try {
    const order = get('SELECT order_ID FROM orders WHERE order_ID = ?', [req.params.orderId]);
    if (!order) return res.status(404).send('ไม่พบคำสั่งซื้อ');
    const QRCode = require('qrcode');
    const statusUrl = `${req.protocol}://${req.get('host')}/check-order-status?order_id=${encodeURIComponent(order.order_ID)}`;
    const image = await QRCode.toBuffer(statusUrl, { width: 220, margin: 1, type: 'png' });
    return res.type('png').send(image);
  } catch (error) {
    return next(error);
  }
});

app.use((error, req, res, next) => {
  console.error(error);
  return res.status(500).send('ไม่สามารถโหลดข้อมูลจากฐานข้อมูล flower2 ได้ กรุณาตรวจสอบโครงสร้างฐานข้อมูล');
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

process.on('SIGINT', () => { db.close(); process.exit(0); });
process.on('SIGTERM', () => { db.close(); process.exit(0); });
