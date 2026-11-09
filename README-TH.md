# Engineering Standards Hub — OCR ใน Google Apps Script

รุ่น `2026-11-09-native-drive-ocr` สำหรับโครงการ **Owner** เดิม ใช้ Google Drive แปลง PDF สแกนผ่าน Google Docs โดย Apps Script แยกทีละหน้าให้ก่อน จึงแสดง **เลขหน้าตามลำดับของ PDF ต้นฉบับ** ได้ (เริ่มนับปกเป็นหน้า 1) ไม่ต้องใช้ PaddleOCR, Docker, Node.js, Vision API, Document AI หรือ Cloud Storage สำหรับ OCR รุ่นนี้ หากเคยตั้ง Document AI สำหรับ Word/PDF ปกติ ให้คงการตั้งค่าส่วนนั้นได้

ปุ่ม **Refresh** อัปเดตรายการเหมือนเดิม ไม่สร้างดัชนี OCR และการค้นหาอ่านเฉพาะดัชนีที่พร้อม ไม่เรียก OCR ซ้ำ ผล OCR ไม่ออกทาง API สาธารณะเดิม ผู้ดูแลทดสอบผ่านหน้า Owner และสมาชิกที่มีสิทธิ์ค้นผ่านหน้า Reader ส่วนตัว

## 1. ติดตั้งไฟล์ในโปรเจกต์ Owner

ก่อนแก้ ให้สำรองโค้ดและจดเวอร์ชันที่ใช้ปัจจุบันใน **Deploy → Manage deployments** หาก URL เดิมของเว็บเปิด `/exec?action=health` แล้วเห็นหน้า Reader แทน JSON ของ Engineering Standards Hub API ให้กู้ deployment เดิมและแยก Owner/Reader ก่อน

| ไฟล์ใน ZIP | ทำใน Apps Script Editor |
|---|---|
| `owner/Code.gs` | วางทับไฟล์โค้ดหลักเดิมของ **Owner** ถ้าชื่อเดิมคือ `owner.gs` ให้แก้ไฟล์นั้น ไม่สร้างไฟล์หลักซ้ำ |
| `owner/DriveOcr.gs` | **Files → + → Script** ตั้งชื่อ `DriveOcr` แล้ววางทั้งไฟล์ |
| `owner/PdfLib.gs` | **Files → + → Script** ตั้งชื่อ `PdfLib` แล้ววางทั้งไฟล์ เป็นโค้ดสำหรับแยก PDF ที่รวมมาให้แล้ว ไฟล์มีขนาดใหญ่ |
| `owner/PdfOcrPilot.html` | **Files → + → HTML** ตั้งชื่อ `PdfOcrPilot` หรือแทนไฟล์ชื่อนี้ถ้ามีแล้ว |
| `owner/PrivatePageBroker.gs` | ถ้าจะให้ทีมค้นผ่าน Reader ให้เพิ่มหรือวางทับไฟล์ `PrivatePageBroker` ให้มีเพียงไฟล์เดียว |

ถ้าเคยติดตั้งชุด PaddleOCR ให้ลบ `PaddlePageJobs.gs` ออกจากสำเนาโค้ดที่กำลังแก้หลังสำรองไว้แล้ว ชุดใหม่นี้ไม่อ่านค่า `PADDLE_OCR_URL` และ `PADDLE_OCR_TOKEN` และไม่ย้ายผล OCR จากชุดเก่าอัตโนมัติ หากมีโค้ดปรับเอง ให้เปรียบเทียบและรวมการแก้ก่อนนำ `Code.gs` ไปแทนไฟล์เดิม

**อย่านำ `reader/Code.gs` มาใส่โปรเจกต์ Owner** ทั้งสองฝั่งมี `doGet()` คนละตัว

## 2. เพิ่มสิทธิ์ที่ต้องใช้ โดยเก็บ manifest เดิม

1. กดรูปเฟือง **Project Settings** → เปิด **Show “appsscript.json” manifest file in editor** หากเปิดอยู่แล้วให้ข้าม
2. กลับที่ **Editor** → เปิด `appsscript.json` ของ **Owner** คงค่าเดิมทั้งหมด รวมถึง `runtimeVersion: "V8"` และ Advanced Service **Drive v2** เพราะโค้ดรายการเดิมยังใช้ v2 เพิ่มเพียงสองค่าใน array `oauthScopes` โดยคั่นด้วยจุลภาค:
   - `https://www.googleapis.com/auth/drive.file` สำหรับสร้าง อ่าน และลบเอกสาร OCR ชั่วคราวที่แอปสร้าง
   - `https://www.googleapis.com/auth/drive.appdata` สำหรับเก็บดัชนีข้อความแบบส่วนตัว
3. ตรวจว่า scope เดิม `drive.readonly`, `script.external_request`, `script.scriptapp` และ `userinfo.email` ยังอยู่ หากมี `cloud-platform` จากระบบเดิมให้คงไว้ ตรวจว่า Services มี Drive **v2** อยู่แล้ว หาก Apps Script ผูกกับ Cloud project แบบมาตรฐาน ให้เปิด Drive API ใน project เดิมด้วย (ไม่ต้องสร้าง OAuth Client ID สำหรับหน้าเว็บ)
4. กด **Save** และอนุญาตสิทธิ์ด้วยบัญชีเจ้าของเมื่อระบบถาม ถ้าองค์กรบล็อกสิทธิ์ใหม่ ให้แจ้งผู้ดูแล Workspace ตรวจนโยบายเดิม

ตัวอย่างรายการ scope ด้านล่างใช้สำหรับเทียบกับโปรเจกต์เดิม ไม่ใช่ manifest ทั้งไฟล์:

```json
"oauthScopes": [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.appdata",
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/script.external_request",
  "https://www.googleapis.com/auth/script.scriptapp",
  "https://www.googleapis.com/auth/userinfo.email"
]
```

## 3. ตั้งค่าไฟล์ทดสอบ

ใน **Project Settings → Script properties**:

| Property | ค่า |
|---|---|
| `ROOT_FOLDER_ID` | ใช้ ID ของโฟลเดอร์ `31_Standard` เดิม ห้ามใส่ข้อความ placeholder |
| `PDF_OCR_OWNER_EMAIL` | อีเมลเจ้าของที่มีสิทธิ์อ่าน PDF และเป็นบัญชีที่ Deploy Owner |
| `PDF_OCR_FILE_IDS` | ใส่ ID ระหว่าง `/d/` และ `/view` ในลิงก์ PDF เริ่มด้วยไฟล์สแกน 2–3 หน้าในโฟลเดอร์มาตรฐานที่อยู่ในดัชนีแล้ว รองรับสูงสุด 3 ไฟล์ คั่นด้วยจุลภาค |
| `PDF_OCR_TEST_QUERY` | คำหรือวลีที่เห็นอยู่บนภาพสแกนและทราบเลขหน้า เช่น `corrosion allowance` |
| `PDF_OCR_LANGUAGE` | ไม่ต้องตั้งในครั้งแรก ให้ Drive ตรวจภาษาเอง หรือระบุ `th` / `en` เป็นคำใบ้ |

## 4. ทดสอบก่อน Deploy

1. ที่แถบด้านบนของ Editor เลือก **`checkRootFolder` → Run** ควรเห็นชื่อโฟลเดอร์ที่ถูกต้อง ถ้าไฟล์ที่เพิ่งเพิ่มยังไม่อยู่ในดัชนี ให้ใช้ Refresh เดิมก่อน
2. เลือก **`queueDrivePdfOcrPilot` → Run** เพื่อเข้าคิว ยังไม่ทำ OCR
3. เลือก **`processDrivePdfOcrPilot` → Run** ครั้งละหนึ่งหน้า ดูที่ **Execution log** เช่น `{"status":"processing","pagesDone":1,"pageCount":2,"error":""}` กดซ้ำจนได้ `ready` หรือรัน **`startDriveOcrBackground`** ให้ Apps Script ทำหน้าที่เหลือตามรอบประมาณหนึ่งนาทีต่อหน้า ดูผลที่ **Executions** ทริกเกอร์จะหยุดเองเมื่อไม่มีงานค้าง หรือสั่งหยุดได้ด้วย **`stopDriveOcrBackground`**
4. รัน **`testDrivePdfOcrSearch`** ควรได้ `matches: 1` และเลขหน้าที่ตรงกับต้นฉบับ เช่น `pages: [[2]]`
5. เมื่อทดสอบผ่าน ให้ใช้ **Deploy → Manage deployments → Edit → New version → Deploy** ใน deployment **Owner เดิม** เพื่อคง URL และสิทธิ์เข้าถึงเดิม ตรวจ `/exec?action=health` ว่าเป็น `2026-11-09-native-drive-ocr` แล้วเปิด `/exec?action=ocrPilot` ด้วยบัญชี Owner เพื่อดูข้อความที่ไฮไลต์และเลขหน้า
6. หากทีมมี **Reader** ส่วนตัวติดตั้งแล้ว ให้เปิด Reader เดิม วางลิงก์ PDF ที่ได้ `ready` และค้นคำ หากยังไม่มี ให้ทำตาม `READER-SETUP-TH.md` ในโปรเจกต์แยก ทดสอบทั้งบัญชีที่เปิด PDF ได้และบัญชีที่เปิดไม่ได้ก่อนให้ทีมใช้

## ขอบเขตและการแก้ปัญหา

- รุ่นทดสอบ: สูงสุด **3 ไฟล์**, ต้นฉบับ **20 MB / 40 หน้า** ต่อไฟล์ และ **2 MB ต่อหน้า** หลังแยก เริ่มทดสอบด้วยไฟล์เล็ก Google แนะนำให้ใช้ไฟล์เล็กและภาพคมเพื่อผล OCR ที่ดี เลขหน้าเป็นลำดับในตัว PDF ไม่ใช่เลขพิมพ์ในเอกสาร
- ถ้าได้ `HTTP 403` ตอนอ่าน PDF ให้ตรวจสิทธิ์ของบัญชีเจ้าของและนโยบายห้ามดาวน์โหลดของ Drive โค้ดนี้เคารพข้อจำกัดดังกล่าว ถ้าเกิดระหว่างแปลงหรือบันทึก ให้ตรวจ scope, การอนุมัติบัญชี และ Drive API
- ถ้าได้ `no_text` ให้ลองไฟล์สแกนที่คมกว่า หากเปลี่ยนต้นฉบับหรือคำใบ้ภาษา ให้รัน Queue ใหม่ ถ้าได้ `error` ให้แก้สาเหตุแล้วรัน Queue ใหม่เพื่อทำต่อ ระบบจะไม่แสดงผลเก่าหากฉบับของ PDF เปลี่ยน
- เอกสารชั่วคราวสร้างใน My Drive ของบัญชีเจ้าของโดยข้ามค่าแชร์โดยปริยายของโดเมนและลบหลังอ่าน หากงานหยุดกลางทาง ให้รัน `cleanupDriveOcrTemp` ฟังก์ชันนี้ลบเฉพาะ Google Docs ที่แอปทำเครื่องหมายว่าเป็นไฟล์ OCR ชั่วคราว ไม่แตะ PDF ต้นฉบับ ส่วนดัชนีเก็บใน `appDataFolder` ของแอปที่แชร์ไม่ได้
- หากเว็บเดิมผิดปกติหลัง Deploy ให้ย้อน deployment Owner กลับไปใช้เวอร์ชันที่จดไว้ และหยุดทริกเกอร์ OCR แยกถ้าเคยเปิด
- ชุดนี้ผ่านการทดสอบจำลอง รวมถึงแยกไฟล์ PDF ที่มีภาพจริงสองหน้า ยังไม่ได้รันการแปลง OCR จริงใน Google Workspace หรือ Deploy ให้บริษัท

อ้างอิง: [Drive API: import PDF](https://developers.google.com/workspace/drive/api/guides/manage-uploads), [Drive API: files.create](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/create), [appDataFolder](https://developers.google.com/workspace/drive/api/guides/appdata), [คำแนะนำ OCR ของ Google Drive](https://support.google.com/drive/answer/176692?hl=th), [pdf-lib 1.17.1](https://github.com/Hopding/pdf-lib/tree/v1.17.1)
