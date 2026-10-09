# Engineering Standards Hub

เว็บค้นหามาตรฐานวิศวกรรม แยกตาม Electrical, Mechanical, Civil และ Instrument ใช้หน้าเว็บ HTML/CSS/JavaScript และ Google Apps Script เป็น backend

## โครงสร้าง

- `dist/` — หน้าเว็บพร้อมเผยแพร่ รวมตัวอ่าน PDF/Word ในเบราว์เซอร์และไฟล์ vendor ที่จำเป็น
- `apps-script/` — Code.gs, manifest และคู่มือตั้งค่า backend
- `tests/` — การทดสอบ Refresh และการค้นเนื้อหา
- `vercel.json` — ให้ Vercel เผยแพร่เฉพาะ `dist/` โดยไม่ต้อง build
- `index.html` ที่ราก repository — หน้าทดสอบ GitHub–Vercel เดิม เก็บไว้จาก main

## ใช้งานบน Vercel

ใช้ repository นี้ โดยกำหนด Root Directory เป็นราก repository และ Framework Preset เป็น Other การตั้งค่าใน `vercel.json` ระบุ Output Directory เป็น `dist` แล้ว

เมื่อรวม pull request เข้า production branch ระบบ Git integration ของ Vercel อาจเผยแพร่ production อัตโนมัติตามการตั้งค่าของ project ไม่จำเป็นต้องติดตั้ง Node.js บนเครื่องผู้ใช้เพื่อเปิดแอป

## Google Apps Script

หน้าเว็บรุ่นนี้เลิกใช้ OAuth Client ID และ Google Identity Services ในเบราว์เซอร์แล้ว การค้นเนื้อหาและ Refresh เรียก Apps Script Web App ที่กำหนดใน `dist/config.js` ตัว backend ยังต้องได้รับสิทธิ์อ่าน Drive

1. โค้ดสำหรับ repository สาธารณะเว้นค่าเชื่อมต่อไว้: ตั้ง `appsScriptUrl` ใน `dist/config.js` และ `ROOT_FOLDER_ID` ใน `apps-script/Code.gs` ให้เป็นค่าที่ได้รับอนุญาตก่อนใช้งานจริง
2. เปิดโปรเจกต์ Apps Script ที่เป็นเจ้าของ URL ดังกล่าว แล้วตรวจ Code.gs และ Advanced Drive API v2
3. ตั้งค่าสิทธิ์เข้าถึงให้ตรงกับกลุ่มผู้ใช้ของหน่วยงาน และ Deploy เวอร์ชันที่รองรับ action search/pages/refresh
4. หากต้องการเลขหน้าอัตโนมัติ ต้องสร้างดัชนีเอกสารและตั้งค่าสิทธิ์ตาม `apps-script/README.md` ก่อน การย้ายโค้ดขึ้น GitHub ไม่ได้ทำขั้นตอนนี้ให้

เลือก PDF ที่มีข้อความหรือ Word .docx จากเครื่องเพื่อค้นในเบราว์เซอร์ได้ PDF สแกนต้องผ่าน OCR ก่อน ส่วน Word อาจไม่มีข้อมูลตำแหน่งหน้า ควรบันทึกเป็น PDF เมื่อจำเป็นต้องอ้างอิงเลขหน้าที่แน่นอน

## ตรวจสอบโค้ด

สำหรับเครื่องพัฒนาที่มี Node.js:

```sh
node --test tests/refresh.test.cjs tests/content-search.test.cjs
```

ผลตรวจตอนนำเข้ารุ่นนี้: 38 tests ผ่าน เป็นการทดสอบด้วย mock ไม่ใช่การยืนยันว่า Apps Script ที่ Deploy อยู่หรือดัชนีเลขหน้าพร้อมใช้งานจริง

## ที่มารุ่นนี้

Engineering Standards Hub รุ่น 24 จาก source commit `5e8adc94988a39566bd2c58e6cfe185357ac69df` วันที่นำเข้า 9 ตุลาคม 2569

โค้ดรุ่นนี้แทนรหัสโฟลเดอร์ Drive, URL backend และโดเมนบริษัทด้วยค่าตัวอย่างแล้ว ไม่รวมรายการมาตรฐานหรือข้อมูลจัดหมวดจากคลังภายใน หน้าเว็บเริ่มด้วยรายการว่างจนกว่าจะตั้งค่า backend

ไม่ได้รวมไฟล์มาตรฐาน PDF/Word ของบริษัท ข้อมูลที่สร้างระหว่างใช้งาน หรือ credential/token สำหรับ Google, GitHub หรือ Vercel ตรวจเงื่อนไขการใช้ไฟล์ vendor และ LICENSE ที่แนบในแต่ละโฟลเดอร์
