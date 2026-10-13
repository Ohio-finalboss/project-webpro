# รายงานเปรียบเทียบโครงสร้างโค้ดเดิมกับ flower2

## ขอบเขตและวิธีเทียบ

เปรียบเทียบไฟล์ทั้งหมดที่อยู่ในโฟลเดอร์ files, flowershop-order-status และ views_(pleng) กับไฟล์ปัจจุบันใน flower2 โดยจับคู่ตามหน้าที่และ route ไม่ได้จับคู่ด้วยชื่อไฟล์อย่างเดียว เพราะบางส่วนถูกย้ายหรือรวมเข้าไฟล์อื่น

ตรวจพบไฟล์ต้นฉบับทั้งหมด 11 ไฟล์: files 2 ไฟล์, flowershop-order-status 4 ไฟล์ และ views_(pleng) 5 ไฟล์ รายงานนี้ครอบคลุมทุกไฟล์ดังกล่าว โดยระบุคู่เทียบหรือแจ้งกรณีที่ไม่มีไฟล์ตรงกัน

## files

### shop.js

เทียบกับ flower2/routes/shop-builder.js และบางส่วนของ flower2/server.js

- ย้ายจากไฟล์ route ชื่อ shop.js มาเป็น routes/shop-builder.js แล้ว server หลักเป็นผู้ mount router; ความรับผิดชอบของร้านดอกไม้จึงแยกจาก order/payment flow
- เพิ่มการใช้ node:crypto สำหรับ UUID ของ cart และรหัสช่อแบบตรวจความซ้ำ แทนรูปแบบสุ่มจากเวลาและ Math.random ในไฟล์เดิม
- เพิ่ม SERVICE_FEES สำหรับขนาด S/M/L และส่งค่าให้หน้าออกแบบช่อ; บันทึก service_fee ลง bouquets ทั้งตอนเพิ่มและแก้ช่อ ซึ่งไม่มีในไฟล์เดิม
- ยังคงแนวทางตรวจสอบข้อมูลและคำนวณราคาที่ server ไม่เชื่อค่าราคาจาก browser รวมถึงตรวจจำนวนช่อ, จำนวนก้าน, กระดาษ, การ์ด, ของตกแต่ง และ stock
- เพิ่มการรองรับ route หน้าแรกที่ server หลัก และเปลี่ยนรายละเอียดฐานข้อมูลให้เป็นของ flower2
- โครงหลักยังมี helper โหลด catalog, สร้างข้อมูลเริ่มต้นสำหรับ EJS, ตรวจ payload, บันทึก bouquet_items และ routes เพิ่ม/แก้ช่อเหมือนเดิม

### shop.ejs

เทียบกับ flower2/views/shop.ejs

- ไฟล์เดิม 371 บรรทัด; ไฟล์ใหม่ 603 บรรทัด เนื้อหายังเป็นหน้าสั่งทำช่อแบบหลายขั้นและเก็บ CSS/JavaScript ไว้ใน EJS เหมือนเดิม แต่เพิ่มส่วนติดต่อและพฤติกรรมของระบบลูกค้า
- เพิ่มแถบนำทางด้านบนที่มีปุ่ม Home, ตรวจสอบสถานะ และตะกร้าพร้อมจำนวนสินค้า
- เพิ่ม service fee ตาม size ในข้อมูล boot และแสดงค่าจัดรวมในตัวเลือก/สรุปราคา; ข้อมูลที่ส่งกลับ server ยังถูกตรวจและคำนวณซ้ำฝั่ง server
- เพิ่ม/ปรับ flow ให้รองรับการแก้ช่อเดิมจาก cart ผ่านข้อมูล initial/editId, กลับมาแสดงค่าที่บันทึกไว้ แล้วส่ง update ไป route แก้ช่อ
- เพิ่มการแสดงผลที่ responsive และสถานะเลือก/preview ให้ทำงานร่วมกับ route ที่ถูกย้ายไป shop-builder.js

## flowershop-order-status

### package.json

เทียบกับ flower2/package.json

- package เดิมเป็นแอปตรวจสถานะคำสั่งซื้อแยก มี express, ejs และ better-sqlite3
- package ของ flower2 ใช้ฐาน dependency เดิมและเพิ่ม express-session สำหรับจำ state ตะกร้า/การใช้งานข้ามหน้า และ qrcode สำหรับสร้าง QR ที่ใช้เปิด URL ตรวจสถานะบนใบเสร็จ
- ระบบตรวจสถานะไม่ได้ start เป็น server แยกอีกต่อไป แต่ทำงานเป็น route ภายใน server หลักของ flower2

### server.js

เทียบกับส่วนตรวจสถานะใน flower2/server.js

- ไฟล์เดิมเป็น Express app แยก มี route GET /, เปิดฐานข้อมูล flowershop1.db แบบ readonly และ query สำหรับหา order โดยตรง
- flower2 รวม route ตรวจสถานะไว้ที่ GET /check-order-status และ render check-order-status.ejs; route เดิม GET / จึงถูกใช้เป็นหน้าแรก/งานอื่นของระบบหลัก
- helper statusInfo และ formatDate ยังคงแนวคิดเดิม แต่ย้ายมาอยู่ server หลักและใช้ helper get/all/run ร่วมกับ routes พนักงานและลูกค้า
- เปลี่ยนฐานข้อมูลจากไฟล์ในโปรเจกต์ตรวจสถานะที่เปิดอ่านอย่างเดียว ไปใช้ฐานข้อมูล flower2 ที่ server ต้องอ่านและเขียนข้อมูลระบบอื่นได้
- เพิ่มการเชื่อมต่อ session, shop-builder router, order-flow router, SSE และ routes ของพนักงาน; ส่วนตรวจสถานะจึงใช้ data layer และ event stream ร่วมกับระบบอื่น
- การค้น order ยังคง trim, จำกัดความยาว และใช้ parameterized query แบบไม่แยกตัวพิมพ์เล็ก/ใหญ่

### views/index.ejs

เทียบกับ flower2/views/check-order-status.ejs

- เปลี่ยนชื่อ template จาก index.ejs เป็น check-order-status.ejs ให้สื่อหน้าที่ตรงกับ route
- เปลี่ยน form action จาก / เป็น /check-order-status และ placeholder ให้เป็นรูปแบบ order ID ปัจจุบัน
- เปลี่ยนฟอนต์จาก Mali เป็น Prompt และเพิ่ม preconnect ของ Google Fonts
- เพิ่ม customer-nav partial, stylesheet ของ navigation และ live-updates.js; เพิ่ม data-live-region เพื่อแทนเฉพาะบริเวณผลการค้นหาเมื่อมี SSE update
- ส่วนแสดง error, badge, progress steps และรายละเอียด order ยังคงหน้าที่เดิม แต่เชื่อมกับ layout และข้อมูลของ flower2

### public/style.css

เทียบกับ flower2/public/style.css

- โครง CSS หลักและ selector ของหน้าค้นหา/ผลลัพธ์/ขั้นสถานะ/รายละเอียดแทบคงเดิม
- ความเปลี่ยนแปลงด้านการแสดงผลหลักคือ font-family เปลี่ยนจาก Mali, Noto Sans Thai และ Segoe UI มาใช้ Prompt เพื่อให้ตรงกับธีมลูกค้าของ flower2
- ไฟล์ CSS ยังแยกอยู่ใน public และถูกโหลดจาก check-order-status.ejs

## views_(pleng)

### index.js

เทียบกับ flower2/routes/order-flow.js, flower2/routes/shop-builder.js และส่วน route กลางใน flower2/server.js

- ไฟล์เดิมเป็น Express app ขนาดใหญ่ 597 บรรทัด รวมการตั้งค่า server, session, helpers, shop, cart, contact, checkout, payment และ success routes ไว้ในไฟล์เดียว
- flower2 แยกความรับผิดชอบออกเป็น routes/order-flow.js สำหรับ cart/contact/order/payment และ routes/shop-builder.js สำหรับออกแบบ/เพิ่ม/แก้ช่อ; server.js เป็น entry point และยังถือ routes กลาง/พนักงาน
- เปลี่ยน ID cart จากการไล่เลข C00001 และมีการกำหนด cart_ID คงที่ในหน้า cart เดิม มาใช้ UUID ผ่าน crypto.randomUUID() ที่ผูกกับ session
- เปลี่ยน order/payment ID เป็นรหัสที่มี prefix, วันที่ และ random bytes พร้อมตรวจความซ้ำ; สร้างเลขใบเสร็จตามปี
- เพิ่มค่าบริการช่อตาม size ผ่าน service_fee และคำนวณ subtotal จากราคาสินค้าบวกค่าจัด; ค่าส่งยังคำนวณแยกตาม fulfillment
- คงการตรวจข้อมูลลูกค้า เบอร์โทร วัน/เวลา pickup/delivery และการสร้าง order แบบ transaction แต่จัดฟังก์ชันให้แยกตาม route/module
- เพิ่มการแจ้งชำระและ route ยกเลิก payment โดยเปลี่ยน status_order/payment_status เป็นยกเลิกและเก็บข้อมูล order ไว้
- เพิ่ม publish SSE หลังเปลี่ยนสถานะการชำระ/ยกเลิก เพื่อให้หน้า payment หรือ success ที่เปิดอยู่โหลดข้อมูลใหม่ได้
- เปลี่ยน route success จาก parameter :id ใน app เดิมไปใช้ :order_id ใน server หลัก และเพิ่มการตัดสินใจ redirect ตามสถานะ order/payment

### views/cart.ejs

เทียบกับ flower2/views/cart.ejs

- โครงตะกร้าและฟอร์มเปลี่ยนจำนวน/ลบสินค้าใกล้เคียงเดิม; ไฟล์ใหม่เพิ่มบรรทัดแสดง service_fee ต่อช่อ และนำ service fee มารวมในราคารายการ
- แสดงราคาแต่ละรายการด้วย (price_per_unit + service_fee) × quantity ซึ่งเปลี่ยนจากการคิดเฉพาะราคา bouquet
- layout และกลไก cart ยังคงส่งข้อมูลไป route update/delete เดิมในเชิง URL แต่ route จริงถูกรวมอยู่ใน order-flow router

### views/check.ejs

เทียบกับ flower2/views/check.ejs

- โครงหน้าทวนข้อมูลลูกค้า รายการช่อ รายการส่วนประกอบ ค่าส่ง และปุ่มยืนยันยังคงเดิม
- เพิ่มการแสดงราคารายการโดยรวม service_fee ต่อช่อเข้าไปกับ unit price ก่อนคูณจำนวน
- การสร้าง order ไม่เกิดใน EJS; form ยังคง POST ไป /check/confirm และ route ใหม่เป็นผู้ตรวจ session/transaction

### views/inform.ejs

เทียบกับ flower2/views/inform.ejs

- ฟอร์มข้อมูลผู้สั่ง วิธีรับสินค้า ชื่อผู้รับ ที่อยู่ วันและเวลายังคงใช้ POST /inform
- เพิ่ม customer-nav partial และปรับข้อความปุ่มย้อนกลับให้ระบุชัดว่าย้อนกลับไปตะกร้าสินค้า
- คง JavaScript ที่สลับการแสดงช่องกรอกตาม pickup/delivery; การตรวจสอบจริงย้าย/คงอยู่ที่ validateInform ใน route ฝั่ง server
- CSS/markup ปรับระยะและเชื่อม navigation กลาง แต่ไม่ได้เปลี่ยนหน้าที่หลักของข้อมูลในฟอร์ม

### views/payment.ejs

เทียบกับ flower2/views/payment.ejs

- เปลี่ยนแหล่งรูป QR จาก /images/qr-code.png เป็น /src/QR_code.png และเพิ่มข้อความชัดเจนว่ารูป QR เป็นตัวอย่าง ไม่ใช้ชำระเงินจริง
- เพิ่มการแสดง payment_method จากข้อมูล order และเชื่อม live-updates.js เพื่อรับการเปลี่ยนสถานะขณะเปิดหน้า
- เพิ่มปุ่มยกเลิกคำสั่งซื้อที่ POST ไป /payment/cancel/:order_ID; เดิมมีเพียงปุ่มแจ้งชำระ
- ปุ่มยืนยันยัง POST ไป /payment/confirm/:order_ID แต่ flow หลังแจ้งชำระนำไปหน้า /order-success/:order_id เพื่อรอพนักงานเคาน์เตอร์ตรวจ
- เพิ่มการแสดง/จัดวางข้อความตาม flow การชำระและสถานะปัจจุบัน

## ไฟล์ใน flower2 ที่เป็นส่วนเพิ่มหรือไม่มีคู่เทียบโดยตรง

รายการต่อไปนี้เป็นไฟล์ที่เพิ่มเข้ามาเพื่อรวมระบบพนักงาน, shared UI, SSE และหน้าอื่นของระบบ ไม่พบไฟล์เดิมชื่อเดียวกันหรือหน้าที่เทียบตรงในสามโฟลเดอร์ต้นทาง

### Server และ routes

- flower2/server.js — รวม Express app, database, session, status lookup, route success, dashboard, florist/counter routes, receipt และ error handling ไว้เป็น entry point กลาง
- flower2/lib/sse.js — เปิด/ปิด client stream และส่ง shop-update ไปยัง browser ที่ subscribe
- flower2/routes/order-flow.js — แยกตะกร้า/ข้อมูลติดต่อ/checkout/payment/cancel ออกจาก monolithic views_(pleng)/index.js
- flower2/routes/shop-builder.js — พัฒนาจาก files/shop.js; เพิ่ม service fee, UUID และการคงค่าเมื่อแก้ช่อ

### Client scripts และ stylesheets

- flower2/public/live-updates.js — รับ SSE แล้วดึง HTML ใหม่มาแทน data-live-region เฉพาะส่วน
- flower2/public/table-pagination.js — แบ่งหน้าตารางและเริ่มใหม่หลังมีการแทนตาราง
- flower2/public/customer-nav.css — รูปแบบ navigation ลูกค้าที่ใช้ร่วมกัน
- flower2/public/styles.css — ธีมและ layout ของ dashboard พนักงาน
- flower2/public/order-pages.css — รูปแบบหน้า queue, order detail และ receipt ฝั่งพนักงาน

### Views และ partials

- flower2/views/customer-home.ejs — หน้าแรกฝั่งลูกค้า พร้อมทางไปสั่งทำช่อ
- flower2/views/order-success.ejs — หน้าหลังลูกค้าแจ้งชำระ เพื่อให้ไปพบพนักงานเคาน์เตอร์
- flower2/views/home.ejs — dashboard พนักงานจัดดอกไม้/เคาน์เตอร์
- flower2/views/orders.ejs — รายการ order และคิวงานจัดช่อ
- flower2/views/counter-home.ejs — หน้ารายการและติดตามงานของพนักงานเคาน์เตอร์
- flower2/views/order-detail.ejs — รายละเอียด order และฟอร์มการเปลี่ยนสถานะ/กำหนดผู้จัด
- flower2/views/receipt.ejs — ใบเสร็จสำหรับตรวจและพิมพ์หลังยืนยัน payment
- flower2/views/not-found.ejs — หน้าแจ้งไม่พบ order สำหรับงานพนักงาน
- flower2/views/partials/customer-nav.ejs — navigation ที่ include ในหน้าลูกค้า
- flower2/views/partials/fonts.ejs — การโหลดฟอนต์ร่วม
- flower2/views/partials/order-status.ejs — badge สถานะที่ reuse ในหน้าอื่น

## สรุปภาพรวม

โค้ดเดิมแบ่งเป็นหน้าออกแบบช่อ, แอปตรวจสถานะ และแอป order flow ที่แยกกันหรือรวมทุกอย่างไว้ในไฟล์เดียว ส่วน flower2 รวมทั้งสามส่วนเข้ากับ server/database/session เดียว แยก route ตามหน้าที่ เพิ่ม service fee, UUID, cancel payment, customer navigation, employee workflows และ SSE; ไฟล์ EJS เดิมหลายหน้าได้รับการต่อยอดแทนการรื้อหน้าที่หลักทั้งหมด

รายงานนี้เป็นการตรวจเปรียบเทียบแบบอ่านซอร์ส ไม่ได้แก้ไขโค้ดระบบ และไม่ได้รัน integration test
