# Engineering Standard — เปิดค้นข้อความและเลขหน้าจาก Drive ให้เฉพาะผู้มีสิทธิ์

ชุดนี้เป็นโค้ดสำหรับติดตั้งโดยผู้ดูแล ยังไม่ได้เปลี่ยนสิทธิ์จริงของ Drive, Apps Script หรือ Google Cloud ใช้หน้าอ่านผลแยกจากเว็บหลักในระยะทดสอบ: คัดลอกลิงก์ไฟล์จาก Engineering Standard Hub มาใส่หน้าค้นส่วนตัว โค้ดเดิมของเว็บหลักยังใช้แสดงรายการและค้นหาไฟล์ได้ ส่วนผลข้อความและเลขหน้าจะไม่ส่งผ่าน API ค้นหาสาธารณะเดิม

หากตั้งคิว Google Drive OCR และทดสอบไฟล์จนได้ ready ตาม README-TH.md แล้ว ให้ข้ามการสร้างดัชนี Layout Parser สำหรับ PDF นั้น และทำขั้นตอนโปรเจกต์ใหม่ได้เลย

## 1. Apps Script เดิมของ Engineering Standard Hub (บัญชีผู้ดูแล)

1. ติดตั้งชุด Owner ตาม `README-TH.md` และทำ OCR ไฟล์ทดสอบจนได้ `ready` ก่อน
2. ใช้ `owner/Code.gs` แทน Code.gs เดิม และเพิ่มไฟล์ Script ชื่อ `PrivatePageBroker` จาก `owner/PrivatePageBroker.gs` คงไฟล์และ scope ของ OCR ตามคู่มือหลัก
3. ใน **Project Settings → Script properties** ตั้งค่า:
   - `ROOT_FOLDER_ID`: โฟลเดอร์ 31_Standard เดิม ถ้าตั้งไว้แล้วให้ใช้ค่าเดิม
   - `PAGE_SEARCH_DOMAIN`: โดเมน Google Workspace ขององค์กร เช่น `example.com` เมื่อยืนยันว่าเป็นโดเมนของบัญชีทีมจริง
   - `PRIVATE_PAGE_OWNER_EMAIL`: อีเมลผู้ดูแลคนเดียวกับบัญชีที่ Deploy และเป็นเจ้าของการเข้าถึงดัชนี
   - `PRIVATE_PAGE_SHARED_KEY`: สุ่มรหัสลับอย่างน้อย 48 ตัวอักษรจากเครื่องมือสร้างรหัสขององค์กร ใช้ค่าเดียวกันในโปรเจกต์ส่วนตัว เก็บใน Script properties ทั้งสองที่เท่านั้น
   - เฉพาะทดสอบ Layout Parser เดิม: `PRIVATE_PAGE_TEST_FILE_ID`: ID ของ PDF/DOCX ทดสอบหนึ่งไฟล์ที่อยู่ใน 31_Standard
   - เฉพาะใช้ Layout Parser เดิม: `DOC_AI_PROJECT_ID`, `DOC_AI_LOCATION`, `DOC_AI_PROCESSOR_ID`, `PAGE_GCS_BUCKET`: ตั้งค่าของ Layout Parser และ bucket แบบส่วนตัวเดิม ให้บัญชีผู้ดูแลและ Document AI มีสิทธิ์ตามบทบาท ระบบค้นหาสำหรับทีมไม่ต้องได้ IAM ของ bucket
4. ข้ามข้อนี้ถ้า PDF สแกนได้ `ready` จากชุด OCR แล้ว หากทดสอบ Word/PDF ด้วย Layout Parser เดิม ใน Apps Script เดิมให้รัน `checkRootFolder` แล้วรัน `processPrivatePageSample` ให้ได้ `processing` รอ Document AI ประมวลผลแล้วรันซ้ำจน log เป็น `{"status":"ready"}` งานนี้ใช้ Document AI สำหรับไฟล์ที่เลือกเท่านั้นและอาจมีค่าประมวลผล หากใช้ PDF สแกนที่มีดัชนี OCR Pilot พร้อมอยู่แล้ว สามารถทดสอบผล OCR ของไฟล์นั้นได้โดยไม่ต้องรันตัวอย่าง Layout Parser
5. **Deploy → Manage deployments → Edit → New version → Deploy** ที่ deployment เจ้าของซึ่งเว็บใช้ โดยคง URL และ audience เดิม โค้ดใหม่จะส่งข้อความออกทาง POST ที่ตรวจลายเซ็นเท่านั้นสำหรับผลรายไฟล์ของทีม การเรียกแบบเดิมหรือเรียก POST โดยไม่มีลายเซ็นจะไม่ส่งข้อความ
6. เปิด `/exec?action=health` ตรวจ `apiVersion: 2026-11-09-native-drive-ocr` และ `privateDrivePageBrokerConfigured: true` ค่า `pageSearchAllowed: false` บน URL เดิมเป็นไปตามที่ตั้งใจไว้ เพราะหน้านั้นไม่ได้ตรวจสิทธิ์รายไฟล์ของผู้ใช้

## 2. สร้าง Apps Script ใหม่สำหรับหน้าค้นหาของทีม

1. สร้าง **โปรเจกต์แยก** เพื่อไม่ให้ผู้ใช้หน้าค้นหาเรียกฟังก์ชันดูแลดัชนีของโปรเจกต์เดิม
2. วาง `reader/Code.gs` ใน Code.gs เพิ่ม HTML ชื่อ `Index` จาก `reader/Index.html` และใช้ `reader/appsscript.json` เป็น manifest ของโปรเจกต์ใหม่นี้ เปิด Google Drive API หากนโยบายโครงการกำหนดให้เปิดแยก
3. ใน **Script properties** ของโปรเจกต์ใหม่:
   - `PRIVATE_PAGE_ALLOWED_EMAILS`: อีเมลของสมาชิกที่อนุญาตให้ใช้หน้าค้นหา คั่นด้วยจุลภาค ใส่บัญชีรายคน ไม่ใส่อีเมลกลุ่มแทนรายชื่อ
   - `PRIVATE_PAGE_SHARED_KEY`: รหัสลับเดียวกับโปรเจกต์เดิม
   - `PRIVATE_PAGE_BROKER_URL`: URL `https://script.google.com/macros/s/.../exec` ของโปรเจกต์เดิม (ไม่เติมพารามิเตอร์)
4. **Deploy → New deployment → Web app** ตั้ง **Execute as: User accessing the web app** และ **Who has access: เฉพาะผู้ใช้ในองค์กร** ให้เฉพาะผู้ดูแลแก้ไขซอร์ส และส่งเฉพาะลิงก์ Web App ใหม่ให้ทีม ผู้ใช้ต้องอนุญาตให้ Apps Script ตรวจไฟล์แบบอ่านอย่างเดียวด้วยบัญชี Workspace ของตน ไม่ต้องนำ OAuth token ไปใส่ในเว็บ
5. เปิดลิงก์ใหม่ด้วยบัญชีในรายชื่อ วางลิงก์ PDF/DOCX ทดสอบจาก Drive แล้วค้นคำที่ปรากฏจริง ตรวจว่าหน้าและข้อความตรงกับต้นฉบับ จากนั้นลองอีกบัญชีที่เปิดหน้าค้นหาได้แต่ไม่มีสิทธิ์เปิดไฟล์เดียวกัน ต้องถูกปฏิเสธทั้งข้อความและเลขหน้า

## ข้อจำกัดที่ต้องทราบ

- ชุดนี้แสดงผลในหน้า Apps Script ส่วนตัว ยังไม่ฝังข้อความลงเว็บหลัก หากไฟล์ไม่มีดัชนี จะไม่สร้างดัชนีหรือคิดค่าประมวลผลเมื่อผู้ใช้ค้น
- ดัชนี Layout Parser เก่าที่ไม่มีข้อมูลยืนยันฉบับไฟล์ต้องสร้างใหม่ก่อนเปิดให้ทีมอ่าน ชุดนี้รองรับการตรวจฉบับจากวันแก้ไข ขนาด และ checksum
- ผู้ดูแลดัชนีต้องอ่านไฟล์ต้นฉบับตามสิทธิ์ที่ Drive อนุญาต โค้ดไม่ได้เพิ่มสิทธิ์ Drive ไม่ส่งไฟล์ต้นฉบับ และไม่ส่ง OAuth token ไปยังโปรเจกต์เดิมหรือเบราว์เซอร์
- หาก Workspace บล็อกการอนุญาต scope หรือการ Deploy แบบองค์กร ให้ผู้ดูแล Workspace เปิดทางให้โปรเจกต์ของบริษัทตามนโยบายเดิม การเปิดสิทธิ์สาธารณะเพิ่มไม่ใช่ขั้นตอนของชุดนี้
