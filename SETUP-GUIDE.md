# Pagbalik sa Google Apps Script + Bagong Login System (Admin / Evaluator / User)

Ito na ang bagong bersyon ng SMME Dashboard mo — bumalik na ito sa **Google Apps Script** bilang backend (Google Sheets + Google Drive + Gmail/MailApp, tulad ng talagang orihinal na file mo), at dinagdagan ng **login system na may tatlong klase ng account**:

- **Admin** — ikaw. Buong access: nakikita lahat ng application, puwedeng mag-approve/mag-reject, puwedeng mag-review ng bawat naka-attach na document (Valid/Invalid + remarks), at puwedeng mamahala ng mga account (approve/disable) sa bagong "Manage Users" tab.
- **Evaluator** — puwedeng mag-self-register, pero kailangan mo munang i-approve (Pending muna) bago sila makapag-login. Pagka-login, makikita nila lahat ng applications, puwede silang mag-decide (**Pending / Endorsed to Region / On-Going Review / For Compliance**) kasama ng remarks, at — bago pa man iyon — puwede na nilang buksan ang bawat naka-attach na requirement/MOV at markahan itong **Valid** o **Invalid** na may sariling remarks bawat isa (bagong "Documents" button sa Application Status tab). Hindi na nila nakikita ang "Application Form" — review lang ang trabaho nila.
- **User** (mga applicant/schools) — puwedeng mag-self-register at agad-agad Active, walang paghihintay. Pagka-login, ang makikita lang nila ay yung sarili nilang mga na-submit na application (batay sa email address na ginamit nila nung nag-register sila). Puwede rin nilang buksan ang parehong "Documents" button para makita kung Valid/Invalid ang bawat naka-attach nilang requirement, kasama ang remarks ng Evaluator, at kung meron mang na-markang Invalid, may button silang **"Re-upload corrected file"** para palitan lang yung isang file na iyon — hindi na nila kailangang i-resubmit ulit yung buong application.

Ang website mo (index.html) ay may bagong login screen sa harap, pero pareho pa rin ang disenyo/logo/kulay — DepEd navy at gold pa rin, at lahat ng dating features (Application Form, Application Status, Downloadable Forms, dashboard) ay nandiyan pa rin, gumagana pa rin nang eksakto tulad ng dati.

**Mahalagang paalala bago tayo magsimula:** pinili mo yung talagang orihinal, walang-binagong code.gs bilang pundasyon nito — ibig sabihin, bumalik din ang lumang isyu na baka mag-fail ang pagpapadala ng email (MailApp.sendEmail) dahil sa Google Workspace permission restrictions, yung dating dahilan kung bakit tayo nag-explore ng Brevo/Netlify noon. Hindi ito naayos dito dahil sabi mo gusto mo ng talagang orihinal na file. Susubukan lang natin ito sa Bahagi 7 (Testing) — kung mag-fail ang email, gagana pa rin ang buong system (submission, login, evaluation, atbp.), email lang ang apektado, at puwede nating balikan ang Brevo fix kung gusto mo pagkatapos.

## Bahagi 1 — I-deploy ang bagong code.gs sa Apps Script

1. Buksan ang Apps Script project mo (mula sa Google Sheet mo: **Extensions → Apps Script**).
2. Piliin ang buong laman ng `Code.gs` (o kung ano man ang pangalan ng file mo doon) — i-select all (Ctrl+A) at i-delete.
3. Buksan ang `code.gs` na kasama ng zip file na ito, kopyahin ang **buong** laman nito, at i-paste sa Apps Script editor.
4. I-save (Ctrl+S o icon na disk).
5. I-click **Deploy → Manage deployments**.
6. Kung mayroon ka nang existing na Web App deployment: i-click ang ✏️ (edit/pencil icon) sa tabi nito → sa "Version", piliin **New version** → i-click **Deploy**.
   - Kung wala pang deployment: **Deploy → New deployment** → sa gear icon piliin **Web app** → sa "Execute as" piliin **Me** → sa "Who has access" piliin **Anyone** → **Deploy**.
7. Kokopyahin ka ng isang **Web App URL** (nagsisimula sa `https://script.google.com/macros/s/.../exec`). **I-save ito** — kailangan natin ito sa Bahagi 3.

   *Tandaan: kapag nag-deploy ng "New version," dapat manatiling pareho ang Web App URL (hindi nagbabago), kaya kung meron ka nang existing na deployment, hindi mo na kailangang ulitin ang Bahagi 3 kung hindi nagbago ang URL.*

8. Sa unang pagkakataong tatakbo ang script (halimbawa, pag-deploy o pag-run ng function), hihilingin sa iyo ng Google na i-authorize ang script (dahil gumagamit ito ng Sheets, Drive, at Gmail). I-click **Review permissions**, piliin ang account mo, i-click **Advanced → Go to [project name] (unsafe)**, tapos **Allow**. Normal lang ito para sa sarili mong script.

## Bahagi 2 — Buuin ang unang Admin account mo (isang beses lang)

1. Sa Apps Script editor pa rin, sa dropdown ng functions sa itaas (malapit sa ▶ Run button), piliin ang **`createInitialAdmin`**.
2. I-click ▶ **Run**.
3. Gagawa ito ng unang Admin account:
   - Username: `admin`
   - Password: `ChangeThisPassword123`
   - Email: `romblon.sgod.smmes@deped.gov.ph`
4. **Mahalaga:** pagkatapos mong maka-login gamit ito (Bahagi 6), agad na palitan ang password na ito gamit ang bagong **"CHANGE PASSWORD"** button sa sidebar — huwag itong iwanan bilang password mo, kahit sino puwedeng makakita nito sa file na ito.
5. Kung gusto mo ng ibang username/password/email mula umpisa pa lang, puwede mo munang baguhin ang apat na value sa loob ng `createInitialAdmin()` function (nasa dulo ng `code.gs`) BAGO mo i-click Run.

## Bahagi 3 — I-set ang GAS_WEB_APP_URL sa Netlify

Ang website mo ay hindi direktang tumatawag sa Apps Script — dumadaan muna ito sa isang maliit na "proxy" function sa Netlify (`netlify/functions/gas-proxy.js`, kasama sa zip na ito) na siyang tumatawag sa Apps Script Web App URL mo.

1. Pumunta sa Netlify dashboard mo → piliin ang site (smmeapp) → **Site configuration → Environment variables**.
2. Kung mayroon nang mga variable mula sa naunang Airtable/Netlify Blobs na setup (`AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, `BREVO_API_KEY`, atbp.) — puwede mo na silang tanggalin, hindi na sila ginagamit ng bagong setup na ito.
3. Idagdag/i-update ang variable na ito:

   | Key | Value |
   |---|---|
   | `GAS_WEB_APP_URL` | yung Web App URL na kinopya mo sa Bahagi 1, Hakbang 7 (nagtatapos sa `/exec`) |

## Bahagi 4 — I-deploy ang mga bagong files sa Netlify

Ilalagay/papalitan mo ang mga sumusunod na files sa parehong project folder na dine-deploy mo sa Netlify (kung saan naroon ang `index.html` mo):

```
index.html                          ← palitan ang luma
netlify/
  functions/
    gas-proxy.js                    ← palitan ang luma (Airtable version)
netlify.toml                        ← palitan ang luma
```

**Mahalaga:** kung mayroon kang mga lumang files mula sa Airtable/Netlify Blobs na bersyon (hal. `netlify/functions/serve-file.js`, `netlify/functions/lib/schoolTable.js`, `netlify/functions/lib/airtableClient.js`, `netlify/functions/lib/fileStorage.js`, `admin-upload-dashboard-image.html`), puwede mo na silang **burahin** — hindi na sila ginagamit, dahil bumalik na tayo sa Google Drive (sa loob mismo ng `code.gs`) para sa mga na-upload na files at sa dashboard images.

**Kung naka-connect sa GitHub ang site mo:** i-commit at i-push itong mga files papunta sa repo (papalit sa luma), at awtomatikong mag-de-deploy si Netlify.

**Kung manual/drag-and-drop:** palitan ang mga files sa folder mo sa computer, tapos i-drag ulit ang buong folder papunta sa Netlify deploy page (o `netlify deploy --prod` gamit ang Netlify CLI).

**Simula Bahagi 16, may bago nang detalye dito:** ang `index.html` na ipinapadala ko ngayon ay ang **naka-obfuscate/minify na build** — ito pa rin ang i-deploy mo sa Netlify, walang pagbabago sa paraan ng pag-deploy. Basahin ang **Bahagi 17** para sa detalye.

## Bahagi 5 — Ano ang mangyayari sa Google Sheet mo

Awtomatikong gagawa ang bagong code.gs ng **bagong tab** sa parehong Google Sheet mo, pangalang **"Users"** — dito nakatago ang mga account (username, naka-encrypt na password, role, buong pangalan, email, petsa, at status). Hindi mo na kailangang gawin ito manually — awtomatiko itong nabubuo sa unang beses na tatawagin ang alinmang login/register function.

Wala nang ibang binago sa "SchoolData" o "Settings" tabs mo — pareho pa rin ang mga column, maliban sa dalawang bago at opsyonal na column: **Q ("Evaluation Remarks")** na awtomatikong idadagdag kapag unang gumamit ng "Evaluate" ang isang Evaluator/Admin (para doon nakatago ang mga puna/remarks nila sa bawat desisyon), at **R ("MOV Review Data")** na kung saan nakatago ang status (Valid/Invalid/Pending) at remarks ng bawat individual na naka-attach na document — ito yung pinagbabatayan ng bagong "Documents" review feature na tatalakayin sa susunod na bahagi. Huwag itong i-edit nang direkta sa Sheet — JSON data ito na binabasa/binabago ng system mismo.

## Bahagi 6 — Bagong feature: Pag-review ng bawat naka-attach na document

Bukod sa desisyon para sa buong application (Pending / Endorsed to Region / On-Going Review / For Compliance), may bago na ring paraan para tingnan at markahan ang **bawat individual na naka-attach na requirement/MOV**:

1. Sa Application Status tab (Admin/Evaluator/Reviewer/User), may bagong column na **"Documents"** — i-click ang button doon (📄 Review para sa Admin/Evaluator/Reviewer, 📄 View para sa User) para buksan ang listahan ng lahat ng naka-attach na files para sa application na iyon.
2. **Bilang Evaluator, Admin, o Reviewer:** makikita mo ang bawat attachment kasama ang link para buksan/tingnan ang file, isang dropdown (Pending / Valid / Invalid), at isang remarks box. Piliin ang status, maglagay ng remarks kung kailangan, i-click **Save** — per-document ito, kaya iba-iba puwedeng markahan ang bawat isa sa parehong application.
3. **Bilang User:** makikita mo ang parehong listahan pero read-only — status pill (Pending/Valid/Invalid) at ang remarks ng Evaluator kung meron. Sa alinmang naka-mark na **Invalid**, may lalabas na button na **"⬆ Re-upload corrected file"** — doon ka na lang mag-a-attach ng bagong file para doon lang sa specific na requirement na iyon (hindi na kailangang i-resubmit ang buong application form). Awtomatikong babalik sa "Pending" ang status pagkatapos, para malaman ng Evaluator na kailangan na itong i-review ulit.
4. **Mahalaga:** ang feature na ito ay gumagana lang sa mga bagong application (o mga existing application na na-resave/na-touch) simula sa pag-deploy ng update na ito — kasi doon lang nag-uumpisang ma-populate ang bagong column R. Kung may mga lumang application ka na sa Sheet bago ang update na ito, walang lalabas na documents doon hangga't hindi na-re-save ang record na iyon (hal. sa pamamagitan ng isang bagong MOV upload).

## Bahagi 7 — Bagong status ng application (Endorsed to Region / On-Going Review / For Compliance)

Pinalitan na ang dating "Approved / Rejected" na desisyon ng Evaluator/Admin — mas tumutugma na ito sa aktwal na proseso ninyo:

- **Pending** — default status ng bagong application, bago pa ito ma-review. Wala pang gumagalaw dito.
- **Endorsed to Region** — nasuri na at ipinasa/ie-endorse na papunta sa Regional Office.
- **On-Going Review** — kasalukuyang sinusuri/nire-review pa.
- **For Compliance** — may kulang o kailangang ayusin muna ang applicant bago ito matuloy.

Makikita ito sa dalawang lugar:
1. **Application Status tab** — ang dropdown sa "Evaluate" column (Admin/Evaluator lang) ay nagpapalit na ng status ng buong application papunta sa alinman sa apat na ito. (Meron ng ikalimang status, "Returned by Region" — tingnan ang Bahagi 10.)
2. **Dashboard** — anim na scorecard na ngayon: Total Submitted Applications, Pending, Endorsed to Region, On-Going Review, For Compliance, at ang bagong Returned by Region — awtomatiko itong bibilangin base sa Status column ng bawat application.

**Bago para sa "Endorsed to Region":** simula ngayon, **kailangan muna ng naka-attach na endorsement letter** bago ma-save ang desisyong ito — tingnan ang Bahagi 10 para sa detalye.

**Tandaan:** ang per-document na Valid/Invalid review (Bahagi 6) ay HIWALAY dito — iba ang bagay na ineevaluate: ang Bahagi 6 ay para sa bawat individual na naka-attach na file, habang itong Bahagi 7 ay para sa desisyon ng BUONG application.

**Mahalaga para sa mga LUMANG test application:** kung may mga application ka na sa Sheet na naka-mark na "Approved" o "Rejected" mula sa mga naunang testing, hindi na kikilalanin ang mga labels na iyon ng bagong system — mabibilang sila sa "Pending" bucket sa Dashboard, at sa Application Status table, lalabas ang status badge nila bilang kulay-abo na "Other" (dahil hindi na ito kasama sa apat na opisyal na status ngayon). Kung gusto mong ayusin ito, buksan lang ang application na iyon sa "Application Status" at piliin ulit ang tamang bagong status (Endorsed to Region / On-Going Review / For Compliance) mula sa dropdown, i-click Save.

## Bahagi 8 — Paano gagamitin ng mga tao ang bagong login

- **Ikaw (Admin):** mag-login gamit ang `admin` / `ChangeThisPassword123` (Bahagi 2), agad palitan ang password gamit ang "CHANGE PASSWORD" button. Makikita mo lahat ng application, at may extra tab kang "Manage Users" kung saan mo maa-approve o madi-disable ang mga Evaluator/Reviewer/User account.
- **Mga Evaluator (hal. mga taga-SGOD na mag-rereview):** ituro mo sa kanila na pumunta sa site, i-click ang "Register" tab, piliin ang role na "Evaluator", at magparehistro. Sasabihin sa kanila na "Pending pa ang account, hihintayin ang admin approval" — dito ka na papasok: buksan mo ang "Manage Users" tab, hanapin ang account nila, i-click **Approve**. Pagkatapos, puwede na silang mag-login.
- **Mga Reviewer (Region):** kagaya rin ito ng Evaluator — mag-Register sila, piliin ang role na "Reviewer (Region)", Pending muna hanggang i-approve mo sa "Manage Users". Pagka-login, ang makikita lang nila sa "Application Status" ay yung mga application na naka-"Endorsed to Region" — tingnan ang Bahagi 10 para sa buong detalye ng ginagawa nila.
- **Mga applicant/schools (User):** ituro mo rin sa kanila na mag-Register, piliin ang role na "User" — agad silang makaka-login pagkatapos, walang paghihintay. **Mahalaga:** ang email address na gagamitin nila sa pag-register ang siya ring dapat nilang ilagay sa "Email Address" field ng Application Form nila — ito ang ginagamit ng system para malaman kung aling mga submission ang sa kanila. (Awtomatiko na itong nilalagay at nili-lock ng system sa form kapag naka-login sila bilang User, para hindi na sila magkakamali.)

## Bahagi 9 — Testing

1. Buksan ang live site mo, dapat lumabas agad ang login screen (hindi na direktang bukas ang dashboard).
2. Mag-login bilang admin (Bahagi 2), palitan ang password.
3. Mag-register ng isang test User account, mag-submit ng test application gamit ang parehong email — dapat makita mo ito sa "Application Status" nila (sarili lang nila ang makikita).
4. Habang nag-tetest, tingnan kung natatanggap ang email notifications (office notification + acknowledgment sa applicant). **Kung walang email na dumarating**, buksan ang Apps Script editor mo → **Executions** (kaliwang sidebar, icon na parang orasan) → hanapin ang pinaka-huling `saveSchool` execution → tingnan kung may error doon tungkol sa MailApp/permissions. Ito yung dating isyu na binanggit sa itaas — hindi ito hadlang sa ibang parte ng system, pero sabihin mo sa akin kung nangyari ito para maayos natin muli.
5. Mag-register ng test Evaluator account, i-approve mo ito sa "Manage Users", mag-login bilang Evaluator, tapos subukan palitan ang status ng test application (hal. papuntang "Endorsed to Region") sa "Application Status" — dapat lumabas ang desisyon at remarks doon, at dapat mag-update din ang bilang sa Dashboard scorecard.
6. Subukan din i-disable ang isang test account sa "Manage Users" — dapat hindi na sila makapag-login pagkatapos.
7. Sa parehong test application, mag-attach ng ilang MOV files bago i-submit. Pagkatapos, mag-login bilang Evaluator, buksan ang "Documents" button para doon, markahan ang isa **Invalid** na may remarks, at isa **Valid**. Mag-login pabalik bilang yung test User — dapat makita nila ang parehong status/remarks sa kanilang sariling "Documents" view, at may **"Re-upload corrected file"** button sa naka-Invalid na item. Subukan mag-reupload — dapat mag-Pending ulit ang status noon, at hindi dapat maapektuhan yung isa pang item (Valid pa rin dapat).
8. Tingnan din ang Bahagi 10 sa ibaba para sa hakbang-hakbang na testing ng Reviewer role, endorsement letter, at notifications.

## Bahagi 10 — Bagong feature: Reviewer (Region) account, endorsement letter, at notifications

**(A) Kulay ng "Review"/"Save" buttons.** Naayos na rin ang isyu na dating hindi makita ang mga "📄 Review"/"📄 View" (Documents) button at ang "Save" button sa loob ng Documents modal — dating puti-sa-puti dahil walang background color. May kulay na itong asul ngayon sa lahat ng lugar.

**(B) Endorsement letter kapag "Endorsed to Region".** Simula ngayon, kapag pinili ng Evaluator/Admin ang "Endorsed to Region" sa dropdown ng "Evaluate" column at ni-click ang **Save**, lalabas muna ang isang paalala na **"please attached endorsement letter"** at bubukas ang file picker — kailangang pumili ng file (ang endorsement letter) bago matuloy ang pag-save. Kapag naka-attach na ang isang letter sa isang application, hindi na ito uulitin sa susunod na pag-save ng parehong status (hal. remarks-only na update) — basta't hindi binago ang decision papunta sa ibang status at pabalik.

**(C) Bagong role: Reviewer (Region).** Ito yung account para sa Regional Office:
- Mag-Register sila katulad ng Evaluator (piliin ang "Reviewer (Region)"), Pending muna hanggang i-approve ng Admin sa "Manage Users".
- Pag-login nila, ang "Application Status" nila ay awtomatikong naka-filter na sa mga application na naka-**"Endorsed to Region"** lang — wala silang makikitang ibang status.
- May access din silang tumingin at mag-markahan ng Valid/Invalid sa bawat naka-attach na document (parehong "Documents" review na ginagamit ng Evaluator/Admin — tingnan Bahagi 6).
- Sa halip na "Evaluate" dropdown, may button silang **"↩️ Return to Division"** — ito ang gagamitin nila kung may kulang o maling MOV. Kailangan nilang maglagay ng remarks (hindi puwedeng blangko) na magpapaliwanag kung ano ang kailangang ayusin. Pagka-click, mababago ang status ng application papunta sa bagong status na **"Returned by Region"** (may sarili itong dashboard scorecard at badge color — lila).
- Awtomatikong may notification na mapupunta sa Admin at Evaluator pagka-ibinalik ng Reviewer ang isang application, para agad nilang malaman.

**(D) In-app notifications.** May bagong 🔔 "Notifications" button ngayon sa ilalim ng account badge (sa sidebar) — walang email na ipinapadala, sa loob lang ng app makikita. Awtomatikong may notification na dumarating sa:
- **Applicant (User):** tuwing may nagbagong status ang application nila (Endorsed to Region, On-Going Review, For Compliance, o Returned by Region).
- **Admin at Evaluator:** tuwing ibinalik (Return to Division) ng isang Reviewer ang isang application.

May pulang bilang na lalabas sa ibabaw ng 🔔 button kung may unread na notification. I-click ang button para buksan ang listahan, i-click ang isang notification para markahan itong "read", o gamitin ang "Mark all read" link para markahan lahat.

**Paano i-test:**
1. Mag-register ng test Reviewer account, i-approve sa "Manage Users", mag-login.
2. Gamit ang isang Evaluator account, subukan i-save ang "Endorsed to Region" nang WALANG naka-attach na letter — dapat may lalabas na paalala/error. Pagkatapos, ulitin habang naka-attach ng file — dapat matagumpay ito.
3. Mag-login bilang Reviewer — dapat lang makita ang application na kararaang na-"Endorsed to Region".
4. I-click ang "↩️ Return to Division" nang walang laman ang remarks — dapat mag-error. Maglagay ng remarks, i-click ulit — dapat magbago ang status papuntang "Returned by Region", at dapat makita ito sa Dashboard scorecard.
5. Mag-login pabalik bilang Admin o Evaluator — dapat may bagong notification (🔔 na may pulang bilang) tungkol sa pagkaka-return ng Reviewer.
6. Mag-login bilang yung applicant (User) na may-ari ng application — dapat may notification din sila kada pagbabago ng status.

## Buod ng mga bagong function sa code.gs (kung sakaling kailangan mo i-check)

| Function | Sino ang puwede | Ginagawa |
|---|---|---|
| `registerAccount` | Kahit sino | Self-signup bilang User (agad Active), o Evaluator/Reviewer (Pending) |
| `loginAccount` | Kahit sino | Mag-login, nagbabalik ng session token (6 oras bago mag-expire) |
| `logoutAccount` | Naka-login | Inaalis ang session |
| `getMySession` | Naka-login | Ibinabalik ang role/pangalan/email, para hindi mawala ang session pag nag-refresh ng page |
| `changePassword` | Naka-login | Palitan ang sariling password |
| `getMySubmissions` | Naka-login | User: sariling submissions lang. Admin/Evaluator: lahat. Reviewer: yung mga "Endorsed to Region"/"For Approval" (puwede pang i-decide) PATI na yung mga "Approved"/"Returned to Division" na (decided na, read-only na lang — tingnan Bahagi 14) |
| `listUsers` / `setUserStatus` | Admin lang | Tingnan/i-approve/i-disable ang mga account |
| `createAdminAccount` | Admin lang | Gumawa ng dagdag na Admin account |
| `saveSchool` | Naka-login (User) | Mag-submit ng bagong application o mag-update ng existing. Sa bagong submission, required na naka-attach ang MOV para sa BAWAT criteria row (kung may Criteria table ang application type) — tingnan Bahagi 16 |
| `evaluateApplication` | Evaluator/Admin lang | Mag-decide (Pending/Endorsed to Region/On-Going Review/For Compliance) + remarks sa BUONG application. Para sa "Endorsed to Region": (1) required munang "Valid" na ang LAHAT ng naka-attach na MOV — tingnan Bahagi 16, (2) kailangan ng isa o higit pang attachment (`attachmentFiles`, array na ngayon — tingnan Bahagi 13) kung wala pa itong naka-attach na endorsement file |
| `reviewerDecide` | Reviewer lang | Palitan ng "For Approval" / "Approved" / "Returned to Division" ang status ng isang application na "Endorsed to Region" (o "For Approval") — tingnan Bahagi 13. Pinalitan na nito ang lumang `reviewerReturnApplication` |
| `getAttachmentReview` | Naka-login | Ibinabalik ang listahan ng lahat ng naka-attach na document + status/remarks nito (Admin/Evaluator/Reviewer: kahit anong application; User: sariling application lang) |
| `reviewAttachment` | Evaluator/Admin/Reviewer | Markahan ang isang partikular na document na Valid/Invalid/Pending + remarks |
| `reuploadAttachment` | May-ari ng application (User) o Admin | Palitan ang file ng isang partikular na document, ibabalik sa Pending ang status nito |
| `getMyNotifications` | Naka-login | Ibinabalik ang mga in-app notification na para sa naka-login (base sa username o role) |
| `markNotificationRead` / `markAllNotificationsRead` | Naka-login | Markahan bilang "read" ang isa o lahat ng sariling notifications |

## Bahagi 11 — Mga follow-up na ayos (dashboard scope, English notifications, tinanggal na Gallery, register popup)

- **Dashboard base sa role.** Dati, iisang set ng numero lang ang lumalabas sa Dashboard scorecards kahit sino ang naka-login. Ngayon: **User** — makikita lang nila ang bilang ng sarili nilang mga application; **Reviewer (Region)** — makikita lang nila ang bilang ng mga application na nasa kanilang "Endorsed to Region" queue; **Admin at Evaluator** — pareho pa rin, makikita nila ang buong bilang ng lahat ng application (walang pagbabago dito).
- **Notifications sa English na.** Yung mga mensahe ng in-app notification (hal. "The status of your application ... has been updated to: ...", "Region returned the application ...") ay nasa English na ngayon, hindi na Taglish.
- **Naayos ang "naiiwan pang lumang datos" sa Dashboard.** Dati, kapag lumipat ka papunta sa ibang tab at bumalik sa Dashboard, hindi na ito nag-a-update — nananatili yung mga LUMANG bilang. Ngayon, kada balik mo sa Dashboard tab, awtomatiko itong kumukuha ng bagong datos mula sa Google Sheet.
- **Tinanggal ang Gallery/image carousel.** Ito pala ang pangunahing dahilan kung bakit mabagal ang buong app — kada pag-load ng Dashboard, sine-scan nito ang BUONG "Dashboard Carousel Images" folder sa Drive at nire-reshare ang bawat file dito, isa-isa. Tinanggal na ito nang tuluyan (sa code.gs at index.html) — mas mabilis na dapat mag-load ang Dashboard ngayon. Kung gusto mo pa rin ng ganitong gallery sa hinaharap, sabihin mo lang para gawan natin ng mas mabilis na paraan.
- **May pop-up na ngayon pag nag-register.** Dati, isang maliit na text lang sa ilalim ng form ang lumalabas pagkatapos mag-register — madaling hindi mapansin. Ngayon, may lalabas na malinaw na message box/pop-up (may "OK" button) — parehong ginagamit ito kung matagumpay ang pag-register (User: puwede nang mag-login; Evaluator/Reviewer: Pending pa, hihintayin ang Admin approval) at kung may error (hal. taken na ang username).

## Bahagi 12 — Bagong pangalan: PROJECT DASIG, at bagong fonts

- **Bagong pangalan.** Pinalitan na ang "School Data Application" ng **PROJECT DASIG** — "Digital Application System for Institutional Governance." Makikita ito sa browser tab title, sa login/register screen, sa itaas ng sidebar, sa Dashboard subtitle, at sa Introduction paragraph. Hindi nagbago ang logo, kulay (DepEd navy/gold), o ang mismong functionality — pangalan lang ang binago.
- **Bagong fonts.** Pinalitan na ang font mula sa dating "Segoe UI" (default ng Windows) tungo sa kombinasyon ng **Poppins** (para sa mga heading, titles, section titles, buttons, at stat numbers — mas bold at modern na hitsura) at **Inter** (para sa body text, paragraphs, table content, at form fields — mas malinaw basahin). Kinukuha ito nang live mula sa Google Fonts, kaya kailangan ng internet connection ang device para makita ang eksaktong fonts na ito (kung offline o naka-block ang Google Fonts, awtomatikong babalik ito sa "Segoe UI"/Arial bilang fallback — gumagana pa rin ang system, sistema lang ng font ang apektado).

**Paano i-test:** Mag-login bilang User at Reviewer (hiwalay na test accounts), tingnan kung tama ang bilang sa Dashboard nila (dapat mas kaunti/naka-filter kumpara sa Admin). Mag-lipat-lipat ng tabs papunta't pabalik sa Dashboard at tingnan kung nag-a-update ang mga numero. Mag-register ng bagong test account at tiyaking may lumalabas na pop-up.

## Bahagi 13 — SHS Tracks Criteria, 3 bagong desisyon ng Reviewer, at updated na Evaluator attachment message

**(A) Nalagyan na ng laman ang "Criteria & Required Documents" ng PROCESSING SHEET ON THE APPLICATION FOR ADDITIONAL SHS TRACKS AND CLUSTER OF ELECTIVES.** Dating blangko ito. Napansin naming pareho pala ang official DepEd form code (**RO-QAD-F-009**) nito at ng "APPLICATION FOR ADDITIONAL TRACKS, STRANDS" (tingnan ang listahan ng Downloadable Forms) — dalawang magkaibang pangalan, iisang opisyal na form lang pala. Kaya sa halip na mag-imbento ng bagong Criteria/Required Documents content (delikado ito kung mali dahil regulatory content ito) o mag-iwan ng blangko, ginawa naming gamitin ng SHS Tracks entry ang eksaktong parehong mga Criteria/Required Documents/MOV entries ng "APPLICATION FOR ADDITIONAL TRACKS, STRANDS" — 11 criteria items, kasama ang lahat ng required documents at MOV nito. **Paalala:** wala kaming natanggap na file na dapat sanang gagamitin para dito — ito ang pinaka-makatwirang resolution na nahanap namin base sa umiiral na datos sa code.gs. Kung mayroon kang eksaktong Criteria/Required Documents na gusto mong ilagay dito na naiiba sa "APPLICATION FOR ADDITIONAL TRACKS, STRANDS", ipadala mo lang at papalitan namin ito.

**(B) Bagong 3 desisyon ng Reviewer (Region), may required na attachment bawat isa.** Sa halip na iisang "↩️ Return to Division" button lang, ngayon ay may dropdown na ang Reviewer sa "Region Action" column, may tatlong opsyon:
- **For Approval** — susunod na hakbang papunta sa approval, walang kinakailangang attachment.
- **Approved** — final na approval ng Region. Kapag pinili ito at wala pang naka-attach na approved documents sa application, lalabas muna ang message box na **"Attach approved documents"** bago bubukas ang file picker (puwede nang mag-attach ng maraming file nang sabay-sabay).
- **Returned to Division** — pinalitan nito ang lumang "Returned by Region" (parehong badge color/dashboard bucket pa rin ang gamit nito para hindi masira ang mga lumang record). Kapag pinili ito at wala pang naka-attach na findings/recommendation, lalabas ang message box na **"Attach findings and recommendation"** bago bubukas ang file picker.

Katulad ng dati, kapag naka-attach na ang kinakailangang file sa isang application, hindi na ito hihingin uli sa susunod na pag-save ng parehong desisyon. Opsyonal na lang ang remarks sa lahat ng tatlong desisyon (dati, required ito sa "Return to Division" — relaxed na ito ngayon dahil ang required na attachment na mismo ang may dalang detalye). May bago ring dalawang column sa Google Sheet: **T (Approved Documents)** at **U (Findings and Recommendation)**.

Mahalagang detalye: kapag pinili munang "For Approval" ang isang application, hindi ito nawawala sa listahan ng Reviewer — makikita pa rin nila ito (kasama ng mga bago pang "Endorsed to Region") para puwede pa rin nilang i-decide sa "Approved" o "Returned to Division" sa susunod. Pagkatapos ma-"Approved" o ma-"Returned to Division", saka lang ito aalis sa kanilang queue.

**(B.1) Saan makikita ang mga in-attach na file (Endorsement Letter, Approved Documents, Findings and Recommendation)?** I-click ang "📄 Review" o "📄 View" button sa "Documents" column ng application sa Application Status — ito na yung parehong modal na ginagamit para tingnan ang per-criteria MOV attachments (Bahagi 6). Ngayon, kung may naka-attach na Endorsement Letter/Processing Sheet, Approved Documents, o Findings and Recommendation ang application, lalabas ang mga ito bilang hiwalay na section sa itaas ng listahan ng MOV — kada file ay clickable link papunta sa Google Drive. Makikita ito ng Admin, Evaluator, Reviewer, at ng may-ari (User) ng application.

**Paano i-test ito:** Pagkatapos mag-attach ng file (endorsement letter, approved documents, o findings), i-click ang "📄 Review"/"📄 View" ng parehong application — dapat makita mo agad ang na-attach na file(s) bilang link sa itaas ng modal, bago pa yung listahan ng MOV.

**(C) Bagong message ng Evaluator kapag "Endorsed to Region".** Pinalitan na ang dating "please attached endorsement letter" ng mas kumpletong **"Attach Endorsement Letter and accomplished Processing Sheet"** — at puwede nang mag-attach ng maraming file nang sabay (hal. parehong Endorsement Letter at Processing Sheet) sa iisang pag-click ng file picker, hindi na isa-isang file lang.

**Paano i-test:**
1. Pumili ng application type na "PROCESSING SHEET ON THE APPLICATION FOR ADDITIONAL SHS TRACKS AND CLUSTER OF ELECTIVES..." sa Application Form — dapat may laman na ang Criteria & Required Documents table.
2. Bilang Evaluator, i-set ang isang application papuntang "Endorsed to Region" nang walang naka-attach — dapat lumabas ang bagong message box na "Attach Endorsement Letter and accomplished Processing Sheet", at pagkatapos i-OK, dapat puwede kang pumili ng maraming file sa file picker.
3. Bilang Reviewer, buksan ang isang "Endorsed to Region" na application — dapat tatlo na ang laman ng dropdown (For Approval / Returned to Division / Approved).
4. Piliin ang "Approved" nang wala pang naka-attach na approved documents — dapat lumabas ang "Attach approved documents" bago ang file picker. Piliin ang "Returned to Division" sa ibang application nang wala pang findings — dapat lumabas ang "Attach findings and recommendation".
5. Piliin muna ang "For Approval" sa isang application — tiyaking hindi ito nawawala sa listahan ng Reviewer, at puwede pa rin itong i-set later papuntang "Approved" o "Returned to Division".
6. Tingnan ang Dashboard — dapat may dalawa nang bagong scorecard: "For Approval" at "Approved", bukod pa sa "Returned to Division" (pinalitan ang label mula "Returned by Region").

Ang lahat ng ibang function (submission, dashboard stats para sa Admin/Evaluator, requirements ng ibang application types, atbp.) ay **hindi ginalaw**.

## Bahagi 14 — Cross-role viewing: makikita ng Evaluator ang in-attach ng Reviewer, at vice versa; hindi na nawawala ang decided applications sa listahan ng Reviewer

Dati, sa sandaling ma-"Approved" o ma-"Returned to Division" ng Reviewer ang isang application, nawawala na ito agad sa kanilang "Application Status" table — kaya wala na silang paraan para balikan at tingnan pa ang sarili nilang naka-attach na Approved Documents o Findings and Recommendation, o maging ang Endorsement Letter/Processing Sheet na in-attach ng Evaluator noon.

Ngayon:
- **Nananatili ang decided applications sa listahan ng Reviewer** — kahit "Approved" o "Returned to Division" na ito, makikita pa rin ito sa kanilang "Application Status" table (bagama't hindi na nila puwedeng baguhin pa ang desisyon dito). Sa halip na dropdown at Save button, may makikita na lang silang "*Decided — see Documents*" sa "Region Action" column — pero gumagana pa rin ang "📄 Review" button para tingnan ang mga attachment.
- **Makikita ng Evaluator/Admin ang lahat ng in-attach ng Reviewer, at makikita ng Reviewer ang in-attach ng Evaluator, sa parehong application** — sa sandaling buksan ang "📄 Review"/"📄 View" ng isang application, makikita doon nang magkasama ang Endorsement Letter/Processing Sheet (in-attach ng Evaluator), Approved Documents at/o Findings and Recommendation (in-attach ng Reviewer) — kung sino man ang naka-login (Admin, Evaluator, Reviewer, o ang may-ari na User), pareho ang makikita nila hangga't may laman ang kaukulang column sa Sheet.

**Paano i-test:**
1. Bilang Evaluator, i-endorse ang isang application papuntang Region (may naka-attach na endorsement letter).
2. Bilang Reviewer, i-"Approve" ang parehong application (may naka-attach na approved documents).
3. Bumalik sa "Application Status" bilang Reviewer — dapat nandiyan pa rin ang application na iyon (may "Decided — see Documents" na sa halip na dropdown), at pag-click ng "📄 Review" ay makikita mo pareho ang Endorsement Letter AT ang Approved Documents.
4. Mag-login bilang Evaluator o Admin, buksan ang parehong application sa Documents — dapat makita rin nila pareho ang Endorsement Letter at ang Approved Documents ng Reviewer (hindi lang yung sarili nilang in-attach).

## Bahagi 15 — Kung "wala pa ring makita" ang mga attachment kahit pagkatapos i-deploy

**Ang #1 na dahilan nito: ang pag-Save lang ng code sa Apps Script editor ay HINDI awtomatikong nag-a-apply sa live Web App URL mo.** Kailangan mo talagang gumawa ng **bagong deployment version** para talagang gumana ang bagong code.gs sa totoong Web App, hindi lang sa editor. Sundin ito:

1. Sa Apps Script editor, i-click ang **Deploy** (kanang-itaas) → **Manage deployments**.
2. Hanapin ang existing Web App deployment mo (yung parehong URL na tinutukoy ng `GAS_WEB_APP_URL` sa Netlify), i-click ang **✏️ (pencil/edit icon)** dito.
3. Sa "Version" dropdown, piliin ang **"New version"** — huwag lang "Save" (Ctrl+S) sa editor mismo, kailangan talaga itong hakbang na ito para talagang mag-apply ang mga bagong function.
4. I-click ang **Deploy**.
5. Kung nagbago ang deployment URL (bihira, pero puwede), i-check at i-update ang `GAS_WEB_APP_URL` sa Netlify environment variables (Bahagi 3), tapos i-trigger ang bagong Netlify deploy.

**Paano malalaman kung ito nga ang dahilan:** buksan mo ang totoong Google Sheet mo (yung "SchoolData" sheet), hanapin ang row ng application na sinusubukan mo, at tingnan ang column **S** (Endorsement Letter / Processing Sheet), **T** (Approved Documents), at **U** (Findings and Recommendation):
- Kung **blangko** ang kaukulang column kahit nag-attach ka na ng file gamit ang app, ibig sabihin hindi pa naka-apply ang bagong `evaluateApplication`/`reviewerDecide` sa totoong deployed Apps Script — sundin ang mga hakbang sa itaas.
- Kung **may laman** ang column (may format na "1. filename" tapos "Link: url" sa susunod na linya), ibig sabihin naka-save na nang tama sa Sheet — ibig sabihin sa frontend side na ang dapat pang tingnan; sabihin mo lang sa akin at may isa pa akong isyu na na-ayos na (`schoolId` type-matching sa pagitan ng Sheet data at ng button click) na kasama na sa pinakabagong index.html na ipinadala.

Kung nasubukan mo na ang lahat ng ito at wala pa ring lumalabas, ipadala mo lang sa akin: (a) anong role ang naka-login, (b) yung School ID ng application na sinusubukan mo, at (c) kung may laman ba talaga ang column S/T/U ng row na iyon sa Sheet — para masasabi ko kung saan talaga nangyayari ang problema.

## Bahagi 16 — Required na ang MOV attachment bago makapag-submit, at required na Valid muna ang lahat bago maka-Endorse to Region

**(A) Hindi na makakapag-submit ang User kung may kulang na MOV.** Dati, puwede pa ring i-submit ang isang bagong application kahit walang naka-attach na MOV sa alinmang criteria — optional lang ito. Ngayon:
- Sa Application Form, hindi na maa-click ang **SUBMIT** button hangga't hindi pa naka-attach ng MOV ang lahat ng row sa "Criteria & Required Documents" table. May lalabas na malinaw na babala sa ilalim ng table na nagsasabi kung anong criteria pa ang kulang (real-time — nawawala ito habang inaattach mo isa-isa ang mga MOV).
- Kahit sino pa ang mag-attempt (halimbawa, kung may direktang tumatawag sa backend nang hindi dumadaan sa page), i-che-check din ito ng code.gs mismo bago tanggapin ang bagong submission — kaya hindi ito puwedeng balewalain.
- Ang mga application type na WALANG interactive na Criteria table (yung mga nagpapakita na lang ng buong document sa preview — walang "📎 Attach MOV" na button), ay EXEMPTED dito dahil wala talagang paraan mag-attach doon.
- Ito ay para sa BAGONG submission lang — hindi ito muling hinihingi sa pag-edit/resave ng existing application na naka-submit na (parehong lenient na approach na ginagamit na rin sa ibang parte ng system).

**(B) Hindi na makakapag-"Endorse to Region" ang Evaluator/Admin kung may hindi pa Valid na MOV.** Dati, kahit hindi pa na-review (Pending o Invalid) ang mga MOV, puwede pa ring i-set ng Evaluator/Admin ang isang application papuntang "Endorsed to Region" (basta't may naka-attach na endorsement letter). Ngayon, bago pa man tingnan ang endorsement letter, che-check muna kung **LAHAT** ng naka-attach na MOV ng application ay naka-mark na "Valid" — kung may kahit isang Pending o Invalid pa, ma-block ang pag-endorse, may lalabas na error na nagsasabi kung alin pa ang kulang i-review. Kailangan munang i-review (Valid/Invalid) ng Evaluator/Admin ang LAHAT ng attachment sa "📄 Review" modal (Bahagi 6) bago sila makapag-endorse.

**Paano i-test:**
1. Mag-submit ng bagong application na may Criteria table (hal. "APPLICATION FOR MERGING OF SCHOOL") nang hindi muna nag-a-attach ng kahit anong MOV — dapat naka-disable ang SUBMIT at may makikitang babala kung anong criteria ang kulang.
2. I-attach ang MOV ng lahat ng criteria isa-isa — dapat unti-unting nawawala ang mga pangalan sa babala, at maging enabled na ang SUBMIT pagka-kumpleto na.
3. Bilang Evaluator, subukang i-set ang bagong application papuntang "Endorsed to Region" nang hindi pa nire-review ang mga MOV — dapat ma-block ito, may error tungkol sa "must be reviewed and marked Valid".
4. Buksan ang "📄 Review" ng application, markahan Valid ang bawat MOV, tapos ulitin ang "Endorsed to Region" — dapat tuloy na ito (basta't may naka-attach na rin ang endorsement letter).

## Bahagi 17 — Pag-secure ng code: obfuscation ng index.html, at ang totoo tungkol sa code.gs

Tinanong mo kung puwedeng "i-secure" ang code para hindi ito ma-view ng mga user. Dalawa itong magkaibang usapin, at magkaiba rin ang totoong nangyayari sa bawat isa:

**(A) Ang `code.gs` — server-side, at HINDI na kailangan pang gawan ng kahit ano.** Ito ang tumatakbo sa Apps Script server, hindi sa browser ng user. Walang paraan ang kahit sinong user na maka-"view source" nito — makikita lang ito ng taong may Edit/View access sa Apps Script project mismo sa Google Drive. Kaya ang totoong dapat mong siguraduhin dito ay: sino-sino ang may access (share settings) sa Apps Script project at sa Google Sheet mismo sa Drive — hindi ito bagay na puwede kong ayusin dito, dahil setting ito sa panig ng Google Drive/Workspace account mo.

**(B) Ang `index.html` — client-side, kaya may limitasyon talaga.** Ito ang tumatakbo sa browser mismo ng user, kaya technically hindi ito puwedeng ganap na itago — ganito rin ang LAHAT ng website sa mundo (kahit ang mga bangko). Ang ginawa ko: (1) **in-obfuscate ko ang JavaScript** — pinaikli/pinalitan ang lahat ng pangalan ng variables sa mga hindi nababasang character, at ni-encode ang mga text/strings — para halos hindi na mabasa ng ordinaryong tao ang laman nito kahit buksan sa View Source; (2) **na-minify** din ang buong HTML/CSS (tinanggal ang extra spaces/comments); (3) **naka-disable ang right-click at ang mga common na DevTools shortcut** (F12, Ctrl+Shift+I, Ctrl+U, atbp.) — pero puwede pa ring mag-right-click PASTE sa loob mismo ng mga text field, para hindi maapektuhan ang normal na paggamit ng form.

**Mahalaga, para malinaw ang expectations:** ito ay deterrent lang laban sa karaniwan/casual na pagtingin — hindi ito totoong "hindi na ma-crack" na proteksyon. Kung talagang determinado at may sapat na teknikal na kaalaman ang isang tao, may mga paraan pa rin silang ma-bypass ito (hal. sa pamamagitan ng browser menu sa halip na keyboard shortcut, o sa pag-disable muna ng JavaScript). Wala rin namang totoong "sikreto" (password, API key, credentials) na nakalagay sa loob ng index.html — ang mga iyon (Spreadsheet ID, Apps Script Web App URL, password hashing) ay nasa server-side na lahat (code.gs at ang `GAS_WEB_APP_URL` environment variable sa Netlify) at hindi kailanman ipinapadala sa browser.

**Paano ito ni-deliver:** dalawang file na ngayon ang index.html —
- **`index.source.html`** — ang readable/malinaw na bersyon. Dito ako gagawa ng lahat ng FUTURE na pagbabago kapag humiling ka pa ng bagong feature o ayos.
- **`index.html`** — ang naka-obfuscate/minify na BUILD, gawa mula sa `index.source.html`. **Ito pa rin ang i-deploy mo sa Netlify** — walang pagbabago sa paraan ng pag-deploy mo (Bahagi 4), palitan mo lang ito ng file na parehong pangalan.
- Kasama rin sa zip ang `build-tools/build-obfuscate.js` — ito ang script na gumagawa ng build mula sa source. Hindi mo na kailangang patakbuhin ito mismo — ako na ang bahalang mag-regenerate ng bagong obfuscated build sa tuwing may bagong hihilingin kang ayusin, at ipapadala ko rin palagi ang parehong `index.source.html` at `index.html` para may updated copy ka ng dalawa.

**Paano i-test:** buksan ang deployed site, subukan mag-right-click sa labas ng anumang text field — dapat walang lumalabas na menu. Subukan pindutin ang F12 o Ctrl+Shift+I — dapat walang bumukas na DevTools panel. Subukan mag-right-click PASTE sa loob ng isang text field (hal. School ID) — dapat gumagana pa rin ito normal.

## Bahagi 18 — Pag-clean ng display text sa Application Form tab

Dalawang hiwalay na text cleanup ang ginawa dito, pareho display-only (walang nabago sa aktwal na data na naka-save sa Sheet o ginagamit para sa paghahanap ng requirements):

**(A) Tinanggal ang "PROCESSING SHEET ON THE" mula sa mga pangalan ng application type — sa Application Form tab lang.** Dati, ganito lumalabas ang mga application type sa dropdown menu, sa grid ng type-selection screen, sa "Selected Type" label, at sa pahina title kapag pumili ka: halimbawa, *"PROCESSING SHEET ON THE APPLICATION FOR ESTABLISHMENT OF NEW PRIVATE SCHOOL"*. Ngayon, awtomatikong tinatanggal na lang ang unahang bahagi na "PROCESSING SHEET ON THE " sa APAT na lugar na ito:
- Ang submenu (dropdown list sa "Application Form" nav item).
- Ang grid ng mga type-card sa type-selection screen.
- Ang "Selected Type" label sa Application Form.
- Ang page title kapag naka-pili ka na ng application type.

Kaya lalabas na lang: *"APPLICATION FOR ESTABLISHMENT OF NEW PRIVATE SCHOOL"* (mas maikli at malinaw).

**Mahalagang tandaan:** hindi ito nakaka-apekto sa **"Downloadable Forms"** tab (magkaibang listahan iyon, may sariling RO-QAD-F-XXX na pang-numero, at hindi nagsisimula sa "PROCESSING SHEET ON THE" kaya hindi rin ito talaga apektado). Hindi rin ito nakaka-apekto sa aktwal na value na naka-save/ipinapadala papuntang Sheet, `saveSchool`, o `getApplicationRequirements` — ang buong/orihinal na pangalan (kasama ang "PROCESSING SHEET ON THE") ang ginagamit pa rin doon sa likod ng eksena, dahil ito pa rin ang tamang key para sa paghahanap ng requirements at para tumugma sa mga existing na naka-save na record sa Sheet. Ang na-format lang ay ang PAGPAPAKITA sa screen — display-only na cosmetic change.

**(B) Ni-clean up ang isang paulit-ulit na criteria item — "Curriculum Evaluation Sheet".** Sa Criteria & Required Documents table ng humigit-kumulang 20+ na application type, may isang criteria item na paulit-ulit lumalabas nang ganito (iba-iba lang ang numero sa unahan depende sa application type): *"8. Curriculum Evaluation Sheet — duly accomplished, showing findings and recommendations for the Curriculum, School Calendar, Class Program, and Teacher's Program"*. Tinanggal na ngayon ang numero sa unahan AT ang "Curriculum Evaluation Sheet — " na parte, kaya ang nalalabing text na lang ay: **"Duly accomplished, showing findings and recommendations for the Curriculum, School Calendar, Class Program, and Teacher's Program"**. Ito ay nagbago sa lahat ng 22 lugar kung saan ito lumalabas sa `code.gs` — dahil ito mismo ang aktwal na criteria text (hindi lang display formatting), ito rin ang lalabas bilang criteria label sa "📄 Review" modal at sa MOV attachment tracking — walang epekto ito sa mga existing na naka-save nang MOV attachment dahil ang pagtutugma ay batay pa rin sa row position/criteria text na kasalukuyang nasa `VERIFIED_REQUIREMENTS`.

**Paano i-test:** pumili ng kahit anong application type na may prefix na "PROCESSING SHEET ON THE" (hal. "Application for Establishment of New Private School") sa Application Form tab — dapat wala nang makikitang "PROCESSING SHEET ON THE" kahit saan sa menu, grid, label, o page title. Sa Criteria table naman, hanapin ang criteria tungkol sa Curriculum Evaluation Sheet — dapat wala nang numero sa unahan at wala nang "Curriculum Evaluation Sheet —", "Duly accomplished..." na lang mismo ang una sa text.

## Bahagi 19 — Makakapag-reupload na ulit ang User ng MOVs kapag "For Compliance" na ibinalik ng Evaluator

May dati nang feature ang system na nagpapahintulot sa User na mag-re-upload ng bagong file para sa isang MOV, PERO limitado lang ito dati sa mga specific na MOV na na-mark na "Invalid" ng Evaluator/Admin sa "📄 Review" modal (per-document). Kung ang buong application ang ibinalik ng Evaluator gamit ang status na **"For Compliance"** (hal. may nakalimutan o mali sa ibang parte ng submission na hindi naman talaga na-mark na "Invalid" isa-isa), wala talagang paraan ang User na mag-reupload — kailangan pa niyang hintayin munang i-mark na "Invalid" ng Evaluator ang bawat specific na MOV.

Ngayon, sa sandaling maging **"For Compliance"** ang status ng buong application, lalabas na ang "⬆ Re-upload file" button sa **LAHAT** ng MOV row ng User sa "📄 View" modal — kahit "Valid" na o "Pending" pa lang ang review status ng specific na MOV na iyon — hindi lang doon sa mga na-mark na "Invalid". Kaya puwede na niyang baguhin/palitan ang kahit anong dokumento na sa tingin niya ay kailangang ayusin, hindi lang yung mga partikular na na-flag.

**Mahalagang tandaan:**
- Ang mga MOV na na-mark talagang "Invalid" ay nananatiling may button na "⬆ Re-upload **corrected** file" (parehong dati) — para malinaw pa rin sa User kung alin talaga ang sinabing may problema.
- Sa mga status na HINDI "For Compliance" (hal. "Pending", "On-Going Review", "Endorsed to Region", atbp.), wala pa ring nagbabagong behavior — button na reupload ay lalabas lang sa mga MOV na "Invalid" ang review status, tulad ng dati.
- Sa sandaling mag-re-upload ang User ng bagong file sa isang MOV, ma-reset ang review status nito pabalik sa "Pending" (parehong existing na behavior) — kailangan itong i-review muli ng Evaluator/Admin.
- Walang binago sa backend (`code.gs`) dito — ang `reuploadAttachment()` function ay wala nang restriction sa overall application status (basta't ikaw ang may-ari ng application, o Admin), kaya ang pagbabagong ito ay purong frontend display lang — nagpapakita lang ng reupload button sa mas maraming sitwasyon.

**Paano i-test:**
1. Bilang Evaluator, i-set ang status ng isang application papuntang "For Compliance" (hindi kailangang i-mark munang "Invalid" ang kahit anong MOV).
2. Mag-login bilang School/User (ang may-ari ng application), buksan ang "Application Status" tab, i-click ang "📄 View" ng application na iyon.
3. Dapat makikita mo na ngayon ang "⬆ Re-upload file" button sa BAWAT MOV row — kahit yung mga wala pang review o naka-"Valid" pa.
4. Mag-upload ng bagong file sa isa sa mga MOV — dapat mag-a-update ito at babalik sa "Pending" ang status nito, at kailangan na naman itong i-review ng Evaluator.
5. Para i-confirm na hindi nasira ang dating behavior: subukan ang parehong hakbang sa isang application na "Pending" pa lang ang status (hindi "For Compliance") — dapat lumabas lang ang reupload button doon sa MOV na "Invalid" ang review status, tulad ng dati.

## Bahagi 20 — Naayos: "✘ Unexpected end of JSON input" pag mag-Attach MOV ng malaking file

**Ang sanhi:** ang bawat pag-attach ng file (MOV, Endorsement Letter, Approved Documents, atbp.) ay dumadaan sa isang Netlify serverless function (`netlify/functions/gas-proxy.js`) bago ito ipasa sa Apps Script. May **hard limit ang Netlify mismo** (bahagi ito ng platform nila, hindi bagay na puwede nating baguhin sa sarili nating code) na humigit-kumulang **6MB** para sa buong laman ng isang request — at dahil ang file ay kinakailangang i-convert muna sa "base64" text bago ito maipadala (na nagpapalaki ng laki nang humigit-kumulang 33%), ang aktwal na pinakamalaking raw file na kaya nito ay mga **~4.5MB na lang**. Kapag nag-attach ka ng file na mas malaki pa dito, tinatanggihan ito ng Netlify bago pa man ito maabot ng ating code — kaya walang totoong error message na naibabalik, "wala lang laman" ang sagot, at ito ang nagreresulta sa nakakalitong error na **"Unexpected end of JSON input"**.

**Ang inayos:**
1. **May limitasyon na sa laki ng file BAGO pa man subukan i-upload** — 3MB per request (mas mababa sa 4.5MB na totoong limitasyon, para may buffer). Kapag sinubukan mong mag-attach ng file na mas malaki dito, agad itong tatanggihan ng browser mismo (hindi na aabot pa sa server), at makikita mo agad ang malinaw na mensahe: *"Masyadong malaki ang file (X MB). Pinakamalaking pwede: 3.0 MB. Paki-compress muna o gumamit ng mas maliit na resolution ng scan/larawan."* Ganito rin ang mangyayari sa Endorsement Letter/Processing Sheet, Approved Documents, Findings and Recommendation, at Re-upload — kahit isa o marami ang piniling file nang sabay, pinagsasama munang tingnan ang TOTAL na laki ng lahat bago payagang mag-upload.
2. May maliit na hint na naman ngayon sa ilalim ng bawat "📎 Attach MOV" button: *"Max 3.0 MB per file"* — para malaman na agad ng User bago pa siya mag-attach.
3. **Kung sakaling may ibang dahilan** (hindi file size) na nagresulta sa parehong uri ng "walang laman" na sagot mula sa server (hal. naputol ang internet connection), pinalitan na rin natin ang generic/technical na "Unexpected end of JSON input" ng mas madaling maintindihang mensahe: *"Nagka-error sa request papunta sa server (walang laman ang sagot). Kadalasang dahilan nito: masyadong malaki ang naka-attach na file, o naputol ang koneksyon. Subukan ulit gamit ang mas maliit na file o mas mabilis na koneksyon."*

**Paano kung kailangan talaga ng User na mag-attach ng file na mas malaki sa 3MB (hal. isang mataas ang resolution na scanned PDF)?** Ipaalam mo lang sa akin kung madalas mangyari ito — may mga paraan tayong puwedeng gawin (hal. i-guide ang User na i-compress muna ang PDF/larawan gamit ang libreng online tool bago i-attach, o baguhin ang buong architecture papuntang direktang pag-upload sa Apps Script nang hindi dumadaan sa Netlify proxy) pero mas kumplikado ito at may sariling trade-offs, kaya sa ngayon ang pinakasimple at ligtas na solusyon muna ay itong malinaw na 3MB na limitasyon.

**Paano i-test:** pumunta sa Application Form, subukan mag-attach ng file na mas malaki sa 3MB sa "📎 Attach MOV" — dapat agad lumabas ang error na "Masyadong malaki ang file..." nang hindi na kailangang maghintay o mag-loading. Subukan ulit gamit ang file na mas maliit sa 3MB — dapat gumana ito nang normal.

## Bahagi 21 — Nawawalang MOV (hal. 4 out of 5 lang na-attach) ay makikita pa rin ngayon sa "📄 Review"/"📄 View"

**Ang dating problema:** kung 5 halimbawa ang required na criteria/MOV ng isang application type pero 4 lang talaga ang na-attach (hal. nakalimutan ng User yung isa, o luma pang application bago pa may "required MOV" na patakaran), ang "📄 Review"/"📄 View" modal ay 4 lang ang ipapakita — yung 5th na hindi talaga na-attach ay **hindi na lumalabas kahit saan**, parang wala lang siyang narealize na kulang, dahil ang listahan doon ay batay lang sa AKTWAL na na-save na data, hindi sa buong listahan ng required criteria.

**Ang inayos:** ngayon, sa tuwing binubuksan ang "📄 Review"/"📄 View" ng isang application (kahit anong role), ipinapakita na ang **LAHAT** ng required na criteria/MOV ayon sa Application Type nito — kahit yung mga walang aktwal na naka-attach na file. Yung criteria na walang file, lalabas itong may markang "*No file attached*" at status na "Pending", kasama pa rin ng review row (dropdown Pending/Valid/Invalid + remarks + Save) kung Admin/Evaluator/Reviewer ang naka-login — para malinaw agad na kulang ito, sa halip na parang wala lang itong record kahit saan.

**Karagdagang proteksyon na kasabay nito:**
- **Hindi na puwedeng markahan na "Valid" ang isang MOV na walang naka-attach na file** — babalik ito ng error kung susubukan.
- Puwede pa ring markahan ng Evaluator/Admin/Reviewer na "Invalid" (kasama ng remarks, hal. "Wala pang naka-attach dito") ang isang criteria kahit hindi pa talaga ito na-attach — para malinaw na naka-flag ito bago pa man i-return ang buong application sa Division/User bilang "For Compliance".
- **Ang "i-endorse to Region" ay hindi na rin puwede** hangga't may kahit isang REQUIRED na criteria na wala pang file o hindi pa Valid — dati, ang tinitingnan lang dito ay yung mga AKTWAL na na-attach (kaya kung may nakalimutang i-attach, puwede pa ring makatawid ito nang hindi na-notice), ngayon kasama na rin sa pagche-check ang mga kulang.
- Sa sandaling i-attach ng User (sa pamamagitan ng "⬆ Re-upload file" — tingnan ang Bahagi 19, na gumagana rin ngayon dito dahil "Pending" ang status ng bagong lumabas na row) ang kulang na MOV, awtomatiko na itong lalabas bilang normal na attachment — puwede na itong i-review at markahan ng Valid, at saka na lang tuluyang makakapag-Endorse to Region ang Evaluator.

**Mahalagang tandaan:** ito ay pinagsama (merge) lang sa PAGPAPAKITA — kung anuman ang aktwal na na-save na file/review data ay hindi nagbabago o nawawala; dinagdagan lang ito ng mga "placeholder" na row para sa mga kulang, batay sa listahan ng requirements ng Application Type na iyon (kaya ito ay gumagana lang sa mga application type na may Criteria table — yung mga walang ganitong table ay hindi apektado, tulad ng dati).

**Paano i-test:**
1. Bilang Evaluator/Admin, buksan ang "📄 Review" ng isang application na may Criteria table (hal. "Application for Merging of School" na may 8 criteria) kung saan alam mong hindi kumpleto ang na-attach na MOV — dapat makita mo pa rin ang LAHAT ng 8 criteria, yung mga walang file ay may "No file attached" at "Pending" status.
2. Subukan markahan na "Valid" ang isang criteria na walang file — dapat ma-block ito.
3. Markahan na lang "Invalid" ang parehong criteria (may remarks) — dapat gumana ito.
4. Subukang i-"Endorse to Region" ang application (bilang Evaluator) kahit Valid na ang lahat ng IBANG MOV — dapat naka-block pa rin ito dahil sa kulang na MOV.
5. I-set munang "For Compliance" ang application, tapos mag-login bilang User (may-ari), buksan ang "📄 View", i-reupload ang kulang na MOV — dapat gumana ito. Markahan itong Valid bilang Evaluator, tapos ulitin ang "Endorse to Region" — dapat tuloy na ito ngayon.
