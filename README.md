# Engineering Standards Hub

ซอร์สสำหรับ GitHub และ Vercel จากเว็บ Engineering Standards Hub เวอร์ชัน 28
(commit `15a5f599d17ec82989af6acc735fb101d1ddfc00`) พร้อม Google Apps Script OCR รุ่นทดลอง

หน้าเว็บยังค้นจากรหัส ชื่อ คำสำคัญ และสาขา รวมถึงอ่าน PDF/Word ที่ผู้ใช้เลือกจากเครื่อง และทำ OCR PDF สแกนในเบราว์เซอร์ด้วยไฟล์ที่อยู่ในชุดนี้ เมื่อยังไม่ตั้งค่า Apps Script เว็บจะแสดงข้อมูลตัวอย่าง 4 รายการ ไม่มีลิงก์หรือดัชนี Drive ของหน่วยงานฝังในซอร์ส

| โฟลเดอร์ | ใช้ทำอะไร |
|---|---|
| `dist/` | หน้าเว็บ HTML/CSS/JS · Vercel เตรียมไลบรารี PDF/OCR ตอน Build |
| `assets/` | ชุดไฟล์ PDF.js และ Tesseract พร้อมสัญญาอนุญาตและชุดภาษาไทย/อังกฤษ |
| `apps-script-ocr/` | ชุด Apps Script OCR ใหม่: Owner สำหรับคิวงาน และ Reader ส่วนตัวสำหรับค้นข้อความและเลขหน้า |
| `apps-script/` | สำเนา Apps Script รุ่นเดิมสำหรับอ้างอิงและรันทดสอบ Refresh |
| `tests/` | ทดสอบ Search, OCR, Refresh และการอ่านผล |

## นำขึ้น GitHub

1. แตก ZIP แล้วเปิด GitHub repository แบบ **Private** จากนั้นกด **Add file → Upload files**
2. ลากไฟล์และโฟลเดอร์ทั้งหมด **ที่อยู่ข้างในโฟลเดอร์ที่แตก ZIP** ลงหน้า GitHub ในรอบเดียว คงโครงสร้างโฟลเดอร์ไว้ และไม่อัปโหลดตัว ZIP
3. ตรวจว่า `README.md`, `vercel.json`, `assets/`, `scripts/` และ `dist/` อยู่ที่รากของ repository แล้วกด **Commit changes** หากใช้ repo เดิม แนะนำให้ทำบน branch ใหม่เพื่อทดสอบก่อนรวมเข้ากับ branch หลัก


## เชื่อม Vercel และ Apps Script

1. สำหรับใช้งานภายใน ให้เปิดการป้องกันการเข้าถึงที่ครอบคลุม URL **Production** ของโครงการก่อนเชื่อมข้อมูลบริษัท สิทธิ์ของ GitHub repository กับสิทธิ์เปิดเว็บเป็นคนละส่วน
2. บน Vercel กด **Add New → Project → Import** แล้วเลือก repository จาก GitHub ให้ **Root Directory** อยู่ที่ราก repo และ **Framework Preset** เป็น **Other** ถ้าระบบให้เลือก ตรวจว่า Build Command ใช้ `node scripts/build-vercel.cjs` และ Output Directory เป็น `dist` ตาม `vercel.json` จากนั้นกด **Deploy** ครั้งแรกโดยยังไม่ตั้ง URL ของ Apps Script แล้วลองค้น `tank inspection` ในข้อมูลตัวอย่าง Node.js ทำงานบน Vercel จึงไม่ต้องติดตั้งบนเครื่องผู้ใช้ หากบัญชีไม่มีสิทธิ์ตั้งค่าป้องกัน Production ให้ใช้ข้อมูลตัวอย่างเท่านั้น
3. ไปที่ **Vercel → Project → Settings → Environment Variables** แล้วเพิ่ม:
   - `APPS_SCRIPT_URL`: URL ของ **Owner** ลงท้าย `/exec` สำหรับดัชนีและปุ่ม Refresh
   - `APPS_SCRIPT_READER_URL`: URL ของ **Reader** ลงท้าย `/exec` (ถ้ามี) เพื่อแสดงลิงก์ **ค้นดัชนี OCR ส่วนตัวของทีม** ในส่วน OCR
4. Deploy ใหม่ แล้วตรวจว่า Owner ตอบที่ `?action=health` และ Reader เปิดด้วยบัญชีที่ได้รับสิทธิ์ หากหน้าเว็บโหลด Apps Script ไม่ได้ ให้ตรวจการลงชื่อเข้าใช้และการเข้าถึง Owner ตามนโยบายองค์กร หากเบราว์เซอร์บล็อกการเชื่อมต่อข้ามเว็บไซต์ ให้ใช้หน้า Reader ส่วนตัวโดยตรง หลีกเลี่ยงการเปิด Owner เป็นสาธารณะเพื่อแก้ปัญหา
5. หากยังไม่ได้ติดตั้ง Apps Script OCR ให้ใช้ [คู่มือภาษาไทย](apps-script-ocr/README-TH.md) และ [วิธีตั้ง Reader](apps-script-ocr/READER-SETUP-TH.md) ให้ Owner/Reader อยู่คนละโปรเจกต์ และเก็บ `ROOT_FOLDER_ID` กับรหัสลับของ Reader ใน Script properties ตามคู่มือ

URL ทั้งสองในค่าตั้งค่าเป็นลิงก์ที่เบราว์เซอร์มองเห็นได้ ใช้เฉพาะ URL ของ deployment ห้ามใส่ token, API key หรือรหัสลับในไฟล์เว็บและตัวแปรสองช่องนี้

OCR จาก Drive ทำจากคิวใน Apps Script ผลข้อความและเลขหน้าดูในหน้า Reader ส่วนตัวหรือหน้า Pilot ของเจ้าของ ไม่ส่งผ่าน API รายการของหน้าเว็บหลัก ปุ่ม Refresh ไม่เริ่ม OCR ส่วน OCR จากไฟล์ในเครื่องยังใช้งานแยกกันในเบราว์เซอร์ได้

## ทดสอบโค้ด

สำหรับผู้ดูแลที่มี Node.js อยู่แล้ว รัน `node scripts/build-vercel.cjs` เพื่อเตรียมไลบรารีใน `dist/vendor/` ก่อนเปิดเว็บผ่าน HTTP server แล้วรัน `node --test tests/*.test.cjs apps-script-ocr/tests/*.test.cjs apps-script-ocr/private-access.test.cjs` จากราก repo การทดสอบ API และ OCR ฝั่ง Apps Script เป็นการจำลอง ต้องทดสอบกับบัญชีบริษัทและไฟล์สแกนจริงก่อนใช้คลังจริง
