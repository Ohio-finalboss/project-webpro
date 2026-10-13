# Flower Shop – สั่งทำช่อดอกไม้และจัดการคำสั่งซื้อ
Node.js + Express + EJS + SQLite (better-sqlite3)

## วิธีรัน (ใน VS Code Terminal)
1. ติดตั้ง Node.js 20 ขึ้นไป (ทดสอบแนวทางกับ Node 24 บน macOS Apple Silicon)
2. `npm install`
3. `npm start`
4. เปิด http://localhost:3000

## เส้นทางหลัก
หน้าแรกสั่งทำช่อ: `http://localhost:3000/`
หน้าพนักงานจัดดอกไม้: `http://localhost:3000/employee/florist`
หน้าเคาน์เตอร์: `http://localhost:3000/employee/counter`
หลังลูกค้าแจ้งชำระ ระบบแสดงหน้าชำระเงินสำเร็จที่ `/order-success/:order_id` พร้อมคำแนะนำให้แจ้งพนักงานเคาน์เตอร์; พนักงานยืนยันและออกใบเสร็จผ่านหน้ารายละเอียดออเดอร์
(ตอนใช้งานจริงให้เปลี่ยน localhost เป็นโดเมนของเว็บ)

## โครงสร้างไฟล์
- `server.js` เซิร์ฟเวอร์ + query ตาราง orders
- `views` หน้าเว็บต่างๆ
- `public` สไตล์ตาม color palette และ src
- `db/flowershop1 (1).db` ฐานข้อมูลที่เซิร์ฟเวอร์ใช้งานปัจจุบัน


## ถ้า npm install มีปัญหา (macOS)
- ลบของเก่าแล้วติดตั้งใหม่: `rm -rf node_modules package-lock.json && npm install`
- better-sqlite3 ต้องเป็นเวอร์ชัน 12 ขึ้นไปจึงรองรับ Node 24 (เวอร์ชัน 11 ไม่มีไฟล์สำเร็จรูป ต้องคอมไพล์เองและมักล้มเหลว)
- โปรเจกต์นี้ใช้ไลบรารี better-sqlite3 ใน npm จึงไม่เกี่ยวกับโปรแกรม `sqlite3` ที่ติดตั้งในเครื่อง
