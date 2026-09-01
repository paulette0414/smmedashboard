# Pagbalik sa Google Apps Script + Bagong Login System (Admin / Evaluator / User)

Ito na ang bagong bersyon ng SMME Dashboard mo — bumalik na ito sa **Google Apps Script** bilang backend (Google Sheets + Google Drive + Gmail/MailApp, tulad ng talagang orihinal na file mo), at dinagdagan ng **login system na may tatlong klase ng account**:

- **Admin** — ikaw. Buong access: nakikita lahat ng application, puwedeng mag-approve/mag-reject, at puwedeng mamahala ng mga account (approve/disable) sa bagong "Manage Users" tab.
- **Evaluator** — puwedeng mag-self-register, pero kailangan mo munang i-approve (Pending muna) bago sila makapag-login. Pagka-login, makikita nila lahat ng applications at puwede silang mag-decide (Approved / Rejected / Pending) kasama ng remarks. Hindi na nila nakikita ang "Application Form" — review lang ang trabaho nila.
- **User** (mga applicant/schools) — puwedeng mag-self-register at agad-agad Active, walang paghihintay. Pagka-login, ang makikita lang nila ay yung sarili nilang mga na-submit na application (batay sa email address na ginamit nila nung nag-register sila).

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

Wala nang ibang binago sa "SchoolData" o "Settings" tabs mo — pareho pa rin ang mga column, maliban sa isang bago at opsyonal na column **Q ("Evaluation Remarks")** na awtomatikong idadagdag kapag unang gumamit ng "Evaluate" ang isang Evaluator/Admin (para doon nakatago ang mga puna/remarks nila sa bawat desisyon).

## Bahagi 6 — Paano gagamitin ng mga tao ang bagong login

- **Ikaw (Admin):** mag-login gamit ang `admin` / `ChangeThisPassword123` (Bahagi 2), agad palitan ang password gamit ang "CHANGE PASSWORD" button. Makikita mo lahat ng application, at may extra tab kang "Manage Users" kung saan mo maa-approve o madi-disable ang mga Evaluator/User account.
- **Mga Evaluator (hal. mga taga-SGOD na mag-rereview):** ituro mo sa kanila na pumunta sa site, i-click ang "Register" tab, piliin ang role na "Evaluator", at magparehistro. Sasabihin sa kanila na "Pending pa ang account, hihintayin ang admin approval" — dito ka na papasok: buksan mo ang "Manage Users" tab, hanapin ang account nila, i-click **Approve**. Pagkatapos, puwede na silang mag-login.
- **Mga applicant/schools (User):** ituro mo rin sa kanila na mag-Register, piliin ang role na "User" — agad silang makaka-login pagkatapos, walang paghihintay. **Mahalaga:** ang email address na gagamitin nila sa pag-register ang siya ring dapat nilang ilagay sa "Email Address" field ng Application Form nila — ito ang ginagamit ng system para malaman kung aling mga submission ang sa kanila. (Awtomatiko na itong nilalagay at nili-lock ng system sa form kapag naka-login sila bilang User, para hindi na sila magkakamali.)

## Bahagi 7 — Testing

1. Buksan ang live site mo, dapat lumabas agad ang login screen (hindi na direktang bukas ang dashboard).
2. Mag-login bilang admin (Bahagi 2), palitan ang password.
3. Mag-register ng isang test User account, mag-submit ng test application gamit ang parehong email — dapat makita mo ito sa "Application Status" nila (sarili lang nila ang makikita).
4. Habang nag-tetest, tingnan kung natatanggap ang email notifications (office notification + acknowledgment sa applicant). **Kung walang email na dumarating**, buksan ang Apps Script editor mo → **Executions** (kaliwang sidebar, icon na parang orasan) → hanapin ang pinaka-huling `saveSchool` execution → tingnan kung may error doon tungkol sa MailApp/permissions. Ito yung dating isyu na binanggit sa itaas — hindi ito hadlang sa ibang parte ng system, pero sabihin mo sa akin kung nangyari ito para maayos natin muli.
5. Mag-register ng test Evaluator account, i-approve mo ito sa "Manage Users", mag-login bilang Evaluator, tapos subukan mag-Approve/Reject ng test application sa "Application Status" — dapat lumabas ang desisyon at remarks doon.
6. Subukan din i-disable ang isang test account sa "Manage Users" — dapat hindi na sila makapag-login pagkatapos.

## Buod ng mga bagong function sa code.gs (kung sakaling kailangan mo i-check)

| Function | Sino ang puwede | Ginagawa |
|---|---|---|
| `registerAccount` | Kahit sino | Self-signup bilang User (agad Active) o Evaluator (Pending) |
| `loginAccount` | Kahit sino | Mag-login, nagbabalik ng session token (6 oras bago mag-expire) |
| `logoutAccount` | Naka-login | Inaalis ang session |
| `getMySession` | Naka-login | Ibinabalik ang role/pangalan/email, para hindi mawala ang session pag nag-refresh ng page |
| `changePassword` | Naka-login | Palitan ang sariling password |
| `getMySubmissions` | Naka-login | User: sariling submissions lang. Admin/Evaluator: lahat |
| `listUsers` / `setUserStatus` | Admin lang | Tingnan/i-approve/i-disable ang mga account |
| `createAdminAccount` | Admin lang | Gumawa ng dagdag na Admin account |
| `evaluateApplication` | Evaluator/Admin lang | Mag-decide (Approved/Rejected/Pending) + remarks |

Ang lahat ng ibang function (submission, dashboard stats, file upload, requirements, atbp.) ay **hindi ginalaw** — eksakto pa rin ito sa orihinal mong code.gs.
