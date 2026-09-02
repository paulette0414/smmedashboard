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
| `getMySubmissions` | Naka-login | User: sariling submissions lang. Admin/Evaluator: lahat. Reviewer: yung mga "Endorsed to Region" lang |
| `listUsers` / `setUserStatus` | Admin lang | Tingnan/i-approve/i-disable ang mga account |
| `createAdminAccount` | Admin lang | Gumawa ng dagdag na Admin account |
| `evaluateApplication` | Evaluator/Admin lang | Mag-decide (Pending/Endorsed to Region/On-Going Review/For Compliance) + remarks sa BUONG application. Kailangan ng endorsement letter (`endorsementFile`) bago tanggapin ang "Endorsed to Region" kung wala pa itong naka-attach na letter |
| `reviewerReturnApplication` | Reviewer lang | Ibalik sa "Returned by Region" ang isang application na "Endorsed to Region", may required na remarks |
| `getAttachmentReview` | Naka-login | Ibinabalik ang listahan ng lahat ng naka-attach na document + status/remarks nito (Admin/Evaluator/Reviewer: kahit anong application; User: sariling application lang) |
| `reviewAttachment` | Evaluator/Admin/Reviewer | Markahan ang isang partikular na document na Valid/Invalid/Pending + remarks |
| `reuploadAttachment` | May-ari ng application (User) o Admin | Palitan ang file ng isang partikular na document, ibabalik sa Pending ang status nito |
| `getMyNotifications` | Naka-login | Ibinabalik ang mga in-app notification na para sa naka-login (base sa username o role) |
| `markNotificationRead` / `markAllNotificationsRead` | Naka-login | Markahan bilang "read" ang isa o lahat ng sariling notifications |

Ang lahat ng ibang function (submission, dashboard stats, file upload, requirements, atbp.) ay **hindi ginalaw** — eksakto pa rin ito sa orihinal mong code.gs.
