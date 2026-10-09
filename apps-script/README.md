# Engineering Standards Hub — ดัชนีเลขหน้า

หน้าเว็บค้นหาจาก Google Drive ได้ว่าไฟล์ใดมีคำค้น แต่ Drive `fullText` ไม่ส่งตำแหน่งหน้า ระบบนี้จึงสร้างดัชนีหน้าในเบื้องหลังด้วย Google Cloud Document AI Layout Parser แล้วเก็บไว้ใน Cloud Storage ของบริษัท เมื่อค้นหาอีกครั้ง แอปจะแสดงเลขหน้าและข้อความสั้น ๆ ของไฟล์ที่ดัชนีพร้อมใช้งานทันที โดยไม่ต้องดาวน์โหลดไฟล์ในเครื่องผู้ใช้

## เตรียมระบบใน Google Cloud ของบริษัท

1. ให้ผู้ดูแลเลือก Google Cloud project ที่บริษัทอนุมัติและเปิด Billing, Document AI API, Cloud Storage API และ Drive API
2. สร้าง **Layout Parser processor** และ **Cloud Storage bucket** ใน location ที่บริษัทอนุมัติเดียวกัน เช่น `asia-southeast1` บันทึก Project ID, Location, Processor ID และชื่อ Bucket
3. เชื่อม Apps Script project เดิมกับ **standard Google Cloud project** ดังกล่าวใน Project Settings
4. มอบสิทธิ์บัญชีที่เป็นเจ้าของ Apps Script ให้เรียก Document AI batch process (`roles/documentai.apiUser`) และอ่าน/สร้าง/ลบ objects ใน bucket (เช่น Storage Object Admin เฉพาะ bucket) พร้อมสิทธิ์อ่านไฟล์ Drive ต้นทาง
5. ให้ผู้ดูแลตรวจสิทธิ์ service agent ของ Document AI ใน bucket สำหรับอ่านไฟล์นำเข้าและเขียนผลลัพธ์ ห้ามตั้ง bucket เป็น public

Layout Parser และการเก็บไฟล์บน Cloud Storage อาจมีค่าใช้จ่ายตามการใช้งาน ให้ตรวจราคาและนโยบายข้อมูลของบริษัทก่อนเริ่มสร้างดัชนีทั้งคลัง

## ปรับ Apps Script เดิม

1. ในโปรเจกต์ Apps Script ที่เป็นเจ้าของ `/exec` เดิม ให้แทนที่เนื้อหา `Code.gs` ทั้งหมดด้วยไฟล์ `Code.gs` ในชุดนี้
2. ไปที่ **Project Settings → Show “appsscript.json” manifest file in editor** แล้วเพิ่ม scopes จาก `appsscript.json` ในชุดนี้เข้ากับ manifest เดิม อย่าลบค่าที่โปรเจกต์ใช้อยู่ ตรวจว่า Advanced Service **Drive API v2** ยังเปิดอยู่
3. ใน **Project Settings → Script Properties** เพิ่ม:

   | Property | ตัวอย่าง | ใช้สำหรับ |
   | --- | --- | --- |
   | `DOC_AI_PROJECT_ID` | `company-standards` | Cloud project ID |
   | `DOC_AI_LOCATION` | `asia-southeast1` | Region ของ processor |
   | `DOC_AI_PROCESSOR_ID` | `abc123...` | Layout Parser processor ID |
   | `PAGE_GCS_BUCKET` | `company-standards-page-index` | Bucket ที่เป็น private |
   | `PAGE_SEARCH_DOMAIN` | `example.com` | โดเมน Google Workspace ที่อ่านผลค้นหน้าได้ |

4. กด Save แล้วเลือก `setupPageIndexing` จากรายการฟังก์ชันด้านบน กด **Run** หนึ่งครั้ง และอนุญาตสิทธิ์ ฟังก์ชันนี้ตรวจ bucket, สร้างงานให้ไฟล์ PDF/DOCX เดิม และตั้ง trigger ตรวจรายการทุก 15 นาที กับประมวลผลเอกสารทุก 5 นาที
5. ไปที่ **Deploy → Manage deployments → Edit → New version → Deploy** โดย **Execute as: Me** เป็นบัญชีบริษัท และ **Who has access: ผู้ใช้ภายในโดเมนบริษัท** ไม่เลือก Anyone
6. เปิด `/exec?action=health` ด้วยบัญชีบริษัท ตรวจ `pageIndexEnabled: true`, `pageSearchAllowed: true`, และ `apiVersion: 2026-10-02-fast-refresh-v7` จากนั้นค้นคำในแอป หน้าแรกของไฟล์ที่ประมวลผลเสร็จจะแสดงในผลค้นหา

## การทำงานและขอบเขต

- คำค้นจะใช้ Google Drive หาไฟล์ที่เกี่ยวข้องก่อน จากนั้นอ่านดัชนีหน้าเป็นชุดละ 12 ไฟล์ และโหลดชุดที่เหลืออัตโนมัติ โดยแสดงไฟล์ที่ตรงคำค้นได้สูงสุด 12 ไฟล์ต่อโฟลเดอร์มาตรฐาน ส่งกลับเฉพาะเลขหน้ากับข้อความสั้น ๆ ไม่ส่ง PDF/Word ทั้งไฟล์ไปที่หน้าเว็บ
- ไฟล์เพิ่มใหม่หรือแก้เนื้อหาจะเข้าคิวในรอบตรวจทุกประมาณ 15 นาที จากนั้นประมวลผลทีละไฟล์ในเบื้องหลัง ส่วนหน้าแอปยังเปิดจากดัชนีเดิมได้ทันที
- รองรับ PDF และ Word `.docx` สำหรับการสร้างดัชนีหน้า ไฟล์ `.doc` เก่าหรือ Google Docs ต้องแปลงเป็น `.docx`/PDF ก่อน
- ไฟล์เกิน 40 MB ไม่เข้าคิวได้สำเร็จใน Apps Script รุ่นนี้; Layout Parser batch รองรับ PDF สูงสุด 500 หน้า ผลเลขหน้าของ Word ขึ้นกับการจัดหน้าในการประมวลผล จึงควรตรวจเอกสารต้นฉบับก่อนอ้างอิง
- ถ้างานใดขึ้น `error` ให้ดู **Executions** ใน Apps Script แก้สาเหตุแล้ว Run `retryPageIndexErrors` หนึ่งครั้ง งานจะกลับเข้าคิว
- ไฟล์นำเข้าและผล JSON ชั่วคราวใน bucket ถูกลบเมื่อสร้างดัชนีสำเร็จ ดัชนีค้นหาที่เก็บไว้ใน bucket ยังมีข้อความจากเอกสาร ต้องใช้สิทธิ์ bucket ตามนโยบายบริษัท
- ผลค้นเลขหน้าจำกัดด้วยโดเมนผู้ใช้ แต่รุ่นนี้ยังไม่ตรวจสิทธิ์ Drive แยกแต่ละไฟล์ ควรใช้กับคลังที่เปิดให้กลุ่มผู้ใช้โดเมนดังกล่าวอ่านได้ทุกฉบับ หากสิทธิ์แต่ละไฟล์ต่างกันต้องเพิ่มการตรวจ ACL ก่อนเปิดใช้
- หาก `/exec?action=health` แสดง `pageSearchAllowed: false` ให้ตรวจการตั้งค่า `PAGE_SEARCH_DOMAIN`, บัญชีที่ Deploy และการเข้าถึงแบบเฉพาะโดเมน ก่อนเปิดใช้เลขหน้า


## แก้ Refresh เป็นบางครั้ง — รุ่น 2026-10-02-refresh-v6

1. เปิดโปรเจกต์ Apps Script เดิม แล้วแทนที่ **Code.gs ทั้งหมด** ด้วยไฟล์รุ่นนี้ กด Save ไม่ต้องเปลี่ยน Root Folder ID, Script Properties, scopes หรือสิทธิ์ของ deployment เดิมเพื่อแก้ Refresh
2. เลือกฟังก์ชัน `setupRefresh` แล้วกด Run หนึ่งครั้ง หากมีดัชนีเดิม จะตรวจและตั้ง trigger ให้ครบโดยไม่สร้างดัชนีใหม่ทุกครั้ง
3. ไปที่ **Deploy → Manage deployments → เลือก deployment URL เดิม → ไอคอนดินสอ → Version: New version → Deploy** ใช้ URL `/exec` เดิม
4. เปิด URL เดิมต่อท้าย `?action=status` ตรวจ `apiVersion: 2026-10-02-refresh-v6` และ `refreshProtocol: 2` หากยังเป็นรุ่นเดิม ต้องแก้ deployment ที่หน้าเว็บเชื่อมอยู่ ไม่ใช่สร้าง version โดยไม่ Deploy
5. เปิดหน้าเว็บ กด Refresh รอจนแสดงข้อมูลจาก Drive หาก backend กำลังทำงาน แอปจะรอและส่งคำขออีกครั้งโดยอัตโนมัติ การเปิดหน้าเว็บยังอ่านดัชนีที่บันทึกไว้ ไม่สแกน Drive

### สิ่งที่แก้

- เมื่อขอล็อกไม่ได้ จะตอบ `accepted: false, busy: true` ไม่ส่งสถานะ complete/error ของงานเก่าเป็นผลคำขอใหม่
- คำขอมี `requestId` และสถานะมี `jobId` เพื่อป้องกันส่งซ้ำและตรวจผลของงานที่รับไว้จริง
- หาก trigger เริ่มขณะที่งานเลขหน้าใช้ล็อกอยู่ จะจัดเวลาเริ่มใหม่ ไม่ทิ้งงานไว้ queued เพราะ exception ตอนขอล็อก
- เก็บกวาดเฉพาะ trigger ที่เรียก execution นี้ ไม่ลบ trigger ของคำขอที่เข้ามาทีหลัง
- อ่าน metadata/chunks จาก snapshot เดียว และ cache ตามรุ่นดัชนี ป้องกันการอ่าน chunks เก่าระหว่างเปลี่ยนรุ่น
- ปัญหาคิวเลขหน้าแสดงเป็น warning แยกจากการสร้างรายการมาตรฐาน
- ไม่ตีความ timeout ของหน้าเว็บว่าคำขอฝั่ง Apps Script ล้มเหลวเสมอไป และคงรายการเดิมไว้เมื่อยังยืนยันผลไม่ได้
- สถานะ running เกิน 7 นาที / queued เกิน 12 นาทีแสดง interrupted เพื่อให้ตรวจ Executions ไม่ใช่รายงานว่ารู้แน่ชัดว่า execution ล้มเหลว

### หากยังเกิดปัญหา

ไปที่ **Executions (ไอคอนนาฬิกาทางซ้าย)** เลือก execution ที่มีเวลาใกล้ตอนกด Refresh ตรวจฟังก์ชัน `doGet`, `rebuildIndex`, `watchIndexChanges`, `processPageIndexQueue` แล้วบันทึกเวลา สถานะ Duration และข้อความ error พร้อมผล `?action=status` ส่งข้อมูลเหล่านี้เพื่อแยก timeout, quota, สิทธิ์ Drive และ API error จริง

การทดสอบในชุดโค้ดนี้จำลองงานชนกันและสถานะตอบกลับได้ แต่ยังไม่ได้ยืนยัน execution หรือ Code.gs ที่เผยแพร่ในบัญชี Google ของทีม หากสแกนทั้งคลังใช้เวลาถึงเพดานของ Apps Script ยังต้องปรับเป็นการสแกนแบ่งชุด ไม่ใช่เพิ่ม timeout หน้าเว็บเพียงอย่างเดียว


## ลดเวลา Refresh — รุ่น 2026-10-02-fast-refresh-v7

### วิธีอัปเดต

1. ใน Apps Script โปรเจกต์เดิม แทนที่ **Code.gs ทั้งหมด** ด้วยไฟล์รุ่น v7 แล้วกด Save ไม่ต้องเพิ่ม scopes, เปลี่ยน Drive API v2, ติดตั้งโปรแกรม หรือเปลี่ยนสิทธิ์เข้าถึง
2. เลือก **setupRefresh → Run** หนึ่งครั้ง เพื่อสร้างฐานข้อมูล ID ของไฟล์/โฟลเดอร์และ Drive change token รอบนี้ยังต้องสแกนทั้งคลัง จึงอาจนานเหมือนเดิม หากโฟลเดอร์อยู่ใน Shared Drive และยังไม่มีดัชนีเดิม อาจต้องสร้างฐานสองรอบเพื่อจับ token ของ Shared Drive ให้ถูกต้อง
3. กด **Deploy → Manage deployments → เลือก deployment เดิม → รูปดินสอ → Version: New version → Deploy** ใช้ URL `/exec` เดิม
4. เปิด URL เดิมต่อท้าย **?action=status** ตรวจ `apiVersion: 2026-10-02-fast-refresh-v7`
5. เปิดหน้าแอปแล้วกด Refresh เมื่อไม่มีการเปลี่ยนแปลง `refreshMode` ควรเป็น **unchanged** หากมีรายการเปลี่ยนแปลง/ยังไม่มีฐาน/ตรวจ changes ไม่สำเร็จ จะเป็น **full_scan**

### สิ่งที่ทำให้เร็วขึ้น

- ตรวจ Drive Changes API เฉพาะตั้งแต่ cursor ที่บันทึกไว้ แทนการอ่านโฟลเดอร์ทั้งหมดทุกครั้ง
- การแก้ไฟล์นอกคลังที่รู้ว่าไม่เกี่ยวข้องจะไม่ทำให้สแกนคลังใหม่ การเพิ่มไฟล์ใต้โฟลเดอร์ในคลัง การลบ การย้ายเข้า/ออก และการแก้ชื่อ/เนื้อหา จะทำให้ตรวจทั้งคลังเพื่ออัปเดตอย่างครบถ้วน
- เมื่อไม่เปลี่ยน ส่งดัชนีเดิมกลับในคำขอ Refresh โดยไม่มี trigger หรือคำขอโหลดรายการเพิ่มเติม
- เมื่อเปลี่ยน หน้าเว็บเรียก `runRefresh` ให้เริ่มงานที่รับไว้ทันที; trigger เป็นตัวสำรองหากหน้าเว็บปิดหรือคำขอเริ่มงานไปไม่ถึง
- ตรวจสถานะครั้งแรกหลัง 1.5 วินาที จากนั้นเพิ่มช่วงรอจนสูงสุด 6 วินาที แทนการรอ 8 วินาทีทุกครั้ง
- เมื่อ version ของดัชนีตรงกับรายการที่หน้าเว็บมีอยู่ จะไม่โหลดรายการซ้ำ
- อ่านสรุปจำนวนดัชนีหน้าที่บันทึกไว้ ไม่คลายบีบอัดคิวประมวลผล PDF/DOCX ทั้งคิวทุกครั้งที่โหลดรายการ
- งานเลขหน้ารอบใหม่จะหลีกทางให้คำขอ Refresh ที่เข้าคิวแล้ว งานเลขหน้าที่ยังรันอยู่จะไม่ถูกหยุด

### ขอบเขตและวิธีวัด

- เป็นการตรวจ changes ก่อนสแกน ไม่ใช่การแก้ดัชนีทีละไฟล์: เมื่อมีรายการในคลังเปลี่ยน ยังใช้การสแกน metadata ทั้งคลัง งาน PDF/DOCX ยังคงทำในเบื้องหลังเฉพาะไฟล์ที่เปลี่ยน
- เมื่อ cursor ใช้ไม่ได้, state ไม่ตรงกับ index, หรือ feed มีมากเกินสองหน้าระหว่างคำขอเว็บ ระบบจะสแกนทั้งคลังเพื่อรักษาความครบถ้วน งาน watcher ตรวจได้สูงสุดสิบหน้าก่อน fallback
- Token ถูกจับก่อนสแกน เพื่อให้การเปลี่ยนระหว่างสแกนถูกตรวจในรอบถัดไป ดัชนี ID และ token เก็บใน Script Properties ไม่ส่งออกไปหน้าเว็บ
- `elapsedMs` ใน status คือเวลาประมวลผลของงานฝั่ง Script ไม่รวมเวลาโหลดเว็บ เครือข่าย และเวลารอ trigger ทั้งหมด ดู `changePages`, `refreshMode`, `warning`, `checkedAt` ประกอบ
- เปรียบเทียบเวลาในหน้าแอป 3 ครั้งโดยไม่มีไฟล์เปลี่ยน กับ 1 ครั้งหลังเพิ่มไฟล์ แล้วดู Executions ของ `doGet`, `rebuildIndex`, `watchIndexChanges` การทดสอบอัตโนมัติเป็นการจำลอง จึงยังไม่รับรองเวลาจริงในบัญชี Google ของทีม
- หากต้องการตรวจทั้งคลังด้วยตนเองเสมอ ให้เลือกฟังก์ชัน **rebuildIndex → Run** ใน editor


## แก้ข้อผิดพลาด Blob — รุ่น 2026-10-02-fast-refresh-v7.1

เมื่อมีข้อความ “วัตถุ Blob ต้องมีประเภทเนื้อหาที่ไม่เป็นนัล” ในขั้นตอนตรวจการเปลี่ยนแปลง สาเหตุคือ `Utilities.newBlob(byteArray)` ไม่มี MIME type ก่อนเรียก `Utilities.ungzip` รุ่นนี้กำหนด `application/gzip` ให้ compressed bytes และ `application/json` ให้ข้อมูล JSON ทั้ง change state และ page queue พร้อมกำหนดชนิดข้อมูลเมื่ออ่าน gzip จาก Cloud Storage

แทนที่ Code.gs ทั้งหมดด้วยรุ่น v7.1 → Save → Deploy → Manage deployments → deployment เดิม → ดินสอ → New version → Deploy ใช้ URL เดิมและ Script Properties เดิม หากเคย Run setupRefresh แล้ว ไม่จำเป็นต้องสร้างฐานใหม่เพียงเพื่อแก้ MIME type เพราะรูปแบบข้อมูลที่เก็บไว้ยังเหมือนเดิม

ตรวจ `?action=status` ว่า `apiVersion` เป็น `2026-10-02-fast-refresh-v7.1` แล้วกด Refresh เมื่อไม่มีไฟล์เปลี่ยน ผลควรมี `refreshMode: unchanged` และไม่มี warning เรื่อง Blob หากมีการเปลี่ยนจริงยังเป็น full_scan ได้ตามปกติ

การทดสอบใหม่จำลองข้อจำกัด MIME type ของ Blob จาก byte array: รุ่น v7 เดิมไม่ผ่านกรณีไม่เปลี่ยน รุ่นแก้ไขผ่านการอ่าน change state และ page queue ทั้งหลังเขียนและเมื่อ cache ว่าง
