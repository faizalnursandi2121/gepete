# ChatGPT Account Creator

![Screenshot Tampilan Program](screenshot.png)

[🇷🇸 Bahasa Indonesia](#indonesian) | [🇬🇧 English](#english)

---

<a id="indonesian"></a>
## 🇮🇩 Bahasa Indonesia

Sebuah skrip otomatisasi berbasis Node.js yang menggunakan Playwright untuk membuat akun ChatGPT secara otomatis. Skrip ini secara mandiri menghasilkan email sementara, nama acak, tanggal lahir, dan menyelesaikan proses pendaftaran di ChatGPT, termasuk melakukan konfirmasi kode verifikasi otp.

### 🌟 Fitur Utama

- **Otomatisasi Penuh**: Mengisi seluruh form pendaftaran ChatGPT secara otomatis.
- **Email Sementara Acak**: Menggunakan API/scraping khusus dari `generator.email` untuk menghasilkan email dan mengambil kode OTP.
- **Bypass & Stealth**: Dilengkapi skrip *stealth* untuk Firefox guna menghindari deteksi webdriver/bot.
- **Data Acak (Faker)**: Menggunakan `@faker-js/faker` untuk penamaan akun yang realistis berdasarkan letak geografis atau acak.
- **Penyimpanan Bertahap & Aman**: Akun hanya ditulis ke `accounts.txt` setelah checkpoint signup valid selesai, 2FA selesai, dan — bila CLIProxy diaktifkan — setelah CLIProxy Codex/OpenAI OAuth terkonfirmasi sukses.
- **Custom Config**: Mendukung pengaturan yang dapat disesuaikan `config.json` untuk *password* default, mode eksekusi (headless), dll.

### 📋 Persyaratan Sistem

Pastikan Anda sudah menginstal:
- **Node.js**: Versi 18.0.0 atau yang lebih baru.
- **NPM**: Biasanya sudah termasuk bersama instalasi Node.js.

### 🚀 Instalasi

1. Pastikan Anda berada di direktori proyek ini.
2. Buka terminal atau Command Prompt.
3. Instal semua paket/library NPM yang dibutuhkan dengan perintah:
   ```bash
   npm install
   ```
4. Instal *binary browser* Firefox untuk Playwright:
   ```bash
   npm run install-browsers
   ```
   *(Catatan: Anda juga bisa menjalankan secara manual `npx playwright install firefox`)*

### ⚙️ Konfigurasi (`config.json`)

Agar skrip dapat berjalan dengan baik, Anda wajib mengatur kata sandi (password). 
Jika `config.json` belum ada, jalankan skrip sekali agar file terbuat secara otomatis. Buka file tersebut dan atur konfigurasinya:

```json
{
  "max_workers": 3,
  "headless": false,
  "slow_mo": 1000,
  "timeout": 30000,
  "password": "REPLACE_WITH_A_PASSWORD_AT_LEAST_12_CHARACTERS",
  "cliproxy_enable_codex_oauth": false,
  "cliproxy_base_url": "",
  "cliproxy_management_key": "",
  "cliproxy_management_auth_mode": "bearer",
  "cliproxy_poll_interval_ms": 2000,
  "cliproxy_poll_timeout_ms": 180000
}
```

* **`password`** (Wajib): Ganti dengan kata sandi yang ingin Anda tetapkan (OpenAI mewajibkan **minimal 12 karakter**).
* **`headless`**: Ubah ke `true` jika Anda tidak ingin memunculkan jendela browser saat proses instalasi berjalan (jalan di latar belakang).
* **`cliproxy_enable_codex_oauth`**: Set ke `true` hanya jika Anda ingin menyalakan alur CLIProxy Codex/OpenAI OAuth setelah signup.
* **`cliproxy_base_url`** dan **`cliproxy_management_key`**: Wajib diisi saat `cliproxy_enable_codex_oauth` aktif. Gunakan base URL CLIProxy yang dapat diakses dari VPS yang sama dan management key yang valid.
* **`cliproxy_management_auth_mode`**: Default `bearer`; gunakan `x-management-key` hanya jika deployment CLIProxy Anda memang memerlukannya.
* **`cliproxy_poll_interval_ms`** / **`cliproxy_poll_timeout_ms`**: Default masing-masing `2000` dan `180000` milidetik.

#### Perilaku saat CLIProxy aktif

- Mode ini mengasumsikan skrip dapat menjangkau endpoint management CLIProxy secara langsung, umumnya dari VPS yang sama.
- Skrip **tidak** akan menulis akun ke `accounts.txt` sampai alur berikut sukses: checkpoint signup ChatGPT valid → setup 2FA → CLIProxy Codex/OpenAI OAuth → konfirmasi durabilitas auth CLIProxy.
- Jika signup berhenti pada URL error/non-sukses, atau jika CLIProxy gagal/timeout/tidak terverifikasi, akun **tidak** akan disimpan.
- Format `accounts.txt` dapat berupa `email|password` atau `email|password|totpSecret` bila 2FA berhasil diaktifkan.

### 💻 Cara Penggunaan

1. Buka terminal dan pastikan ada di dalam direktori proyek.
2. Jalankan skrip dengan mengetik:
   ```bash
   npm start
   ```
   *(Atau secara langsung: `node chatgpt_account_creator.js`)*
3. Anda akan ditanya perihal jumlah akun:
   ```text
   📝 How many accounts do you want to create?
   ```
4. Masukkan angka (misal: `5`) dan tekan `Enter`.
5. Skrip akan membuka Firefox (jika mode headless `false`) dan memulai pembuatan akun satu per satu secara berurutan.
6. Pantau prosesnya! Dalam mode biasa, akun yang lolos checkpoint signup dan 2FA akan disimpan ke `accounts.txt`. Bila `cliproxy_enable_codex_oauth` aktif, penyimpanan baru terjadi setelah CLIProxy OAuth sukses terkonfirmasi. Formatnya bisa `email|password` atau `email|password|totpSecret`.

### ✅ Verifikasi yang tersedia saat ini

Gunakan perintah yang memang sudah ada di repo saat ini:

```bash
npm test
node --test tests/cliproxy-config.test.mjs
node --test tests/cliproxy-management-client.test.mjs
node --test tests/post-signup-oauth-orchestrator.test.mjs
node --test tests/create-account-persistence-gating.test.mjs
node scripts/smoke-post-signup-oauth.mjs --stub-server
node scripts/smoke-post-signup-oauth.mjs --stub-server --failure-mode
node scripts/smoke-post-signup-oauth.mjs
```

Poin penting yang diverifikasi saat ini:
- contract `config.json` untuk CLIProxy
- client management CLIProxy yang memakai endpoint terdokumentasi
- orchestrator OAuth pasca-signup dengan polling `state`
- gating `accounts.txt` agar hanya menulis akun setelah konfirmasi CLIProxy sukses
- smoke runner terintegrasi untuk mode stub deterministik dan mode real yang fail-closed bila konfirmasi CLIProxy hilang

### ⚠️ Disclaimer (Perhatian)

1. **Penggunaan Bebersama** Skrip ini ditujukan murni untuk sekadar alat bantu pembelajaran (*automations web testing*). 
2. Membuat akun dalam jumlah besar secara terus-menerus bisa menyebabkan pemblokiran akses koneksi IP oleh provider situs (Cloudflare / OpenAI). 
3. Gunakan dengan tanggung jawab sendiri. Risiko pemblokiran akun berada di tangan pengguna.

---

<a id="english"></a>
## 🇬🇧 English

An automated Node.js script utilizing Playwright to automatically create ChatGPT accounts. This tool independently generates temporary emails, random names, and birthdays, completing the entire ChatGPT registration process including OTP verification.

### 🌟 Key Features

- **Full Automation**: Seamlessly fills out all ChatGPT registration forms.
- **Temporary Email Generation**: Leverages API/scraping from `generator.email` for email creation and OTP retrieval.
- **Bypass & Stealth**: Integrated Firefox stealth scripts to evade webdriver/bot detection mechanisms.
- **Randomized Data (Faker)**: Employs `@faker-js/faker` for generating realistic, geographically randomized user names.
- **Safe, Gated Storage**: Accounts are written to `accounts.txt` only after the signup success checkpoint passes, 2FA completes, and — when CLIProxy is enabled — CLIProxy Codex/OpenAI OAuth is confirmed successfully.
- **Custom Configuration**: Supports customizable settings via `config.json` for default passwords, execution mode (headless), and more.

### 📋 System Requirements

Ensure you have the following installed:
- **Node.js**: Version 18.0.0 or newer.
- **NPM**: Typically bundled with your Node.js installation.

### 🚀 Installation

1. Navigate to the project directory in your terminal or Command Prompt.
2. Install all required NPM dependencies using:
   ```bash
   npm install
   ```
4. Install the Firefox browser binary for Playwright:
   ```bash
   npm run install-browsers
   ```
   *(Note: You can also manually run `npx playwright install firefox`)*

### ⚙️ Configuration (`config.json`)

To run the script correctly, configuring a secure password is mandatory.
If `config.json` doesn't exist, run the script once to generate it. Open the file and adjust your settings:

```json
{
  "max_workers": 3,
  "headless": false,
  "slow_mo": 1000,
  "timeout": 30000,
  "password": "REPLACE_WITH_A_PASSWORD_AT_LEAST_12_CHARACTERS",
  "cliproxy_enable_codex_oauth": false,
  "cliproxy_base_url": "",
  "cliproxy_management_key": "",
  "cliproxy_management_auth_mode": "bearer",
  "cliproxy_poll_interval_ms": 2000,
  "cliproxy_poll_timeout_ms": 180000
}
```

* **`password`** (Required): Change this to your desired password (OpenAI mandates a **minimum of 12 characters**).
* **`headless`**: Change to `true` if you prefer the browser window not to appear during the creation process (runs silently in the background).
* **`cliproxy_enable_codex_oauth`**: Set to `true` only when you want the CLIProxy Codex/OpenAI OAuth flow to run after signup.
* **`cliproxy_base_url`** and **`cliproxy_management_key`**: Required when `cliproxy_enable_codex_oauth` is enabled. Use the CLIProxy base URL reachable from the same VPS and a valid management key.
* **`cliproxy_management_auth_mode`**: Defaults to `bearer`; use `x-management-key` only if your CLIProxy deployment requires it.
* **`cliproxy_poll_interval_ms`** / **`cliproxy_poll_timeout_ms`**: Default to `2000` and `180000` milliseconds respectively.

#### Behavior when CLIProxy is enabled

- This mode assumes the script can reach the CLIProxy management endpoint directly, typically from the same VPS.
- The script does **not** write to `accounts.txt` until the following chain succeeds: valid ChatGPT signup checkpoint → 2FA setup → CLIProxy Codex/OpenAI OAuth → durable CLIProxy auth confirmation.
- If signup ends on a non-success/error URL, or if CLIProxy fails/times out/cannot be verified, the account is **not** saved.
- `accounts.txt` may contain either `email|password` or `email|password|totpSecret` when 2FA was enabled successfully.

### 💻 Usage

1. Open your terminal and verify you are in the project directory.
2. Run the script by typing:
   ```bash
   npm start
   ```
   *(Alternatively: `node chatgpt_account_creator.js`)*
3. You will be prompted regarding the number of accounts you wish to create:
   ```text
   📝 How many accounts do you want to create?
   ```
4. Input your desired number (e.g., `5`) and press `Enter`.
5. The script will initialize Firefox (if headless mode is `false`) and sequentially process account creation.
6. Monitor the progress! In legacy mode, accounts that pass the signup checkpoint and 2FA are saved to `accounts.txt`. When `cliproxy_enable_codex_oauth` is enabled, local persistence happens only after CLIProxy OAuth success is confirmed. The stored line format can be `email|password` or `email|password|totpSecret`.

### ✅ Available verification commands today

Use only the commands that already exist in the repository today:

```bash
npm test
node --test tests/cliproxy-config.test.mjs
node --test tests/cliproxy-management-client.test.mjs
node --test tests/post-signup-oauth-orchestrator.test.mjs
node --test tests/create-account-persistence-gating.test.mjs
node scripts/smoke-post-signup-oauth.mjs --stub-server
node scripts/smoke-post-signup-oauth.mjs --stub-server --failure-mode
node scripts/smoke-post-signup-oauth.mjs
```

These checks currently verify:
- the CLIProxy `config.json` contract
- the documented CLIProxy management client behavior
- post-signup OAuth orchestration and exact `state` polling
- persistence gating so `accounts.txt` is written only after confirmed CLIProxy success
- the integrated smoke runner in deterministic stub mode and the documented real-mode command that fails closed when CLIProxy confirmation is missing

### ⚠️ Disclaimer

1. **Educational Use Only** This script is intended purely as an educational tool for learning automation and web testing techniques.
2. Continually creating accounts on a massive scale may lead to IP access blockades by site providers (e.g., Cloudflare / OpenAI).
3. Use responsibly and at your own risk. The developer is not liable for any account suspensions or repercussions.

---

## 📜 License / Lisensi

Proyek ini menggunakan lisensi **MIT License**. Anda bebas menggunakan, memodifikasi, dan mendistribusikan kode ini, baik untuk tujuan komersial maupun non-komersial, dengan syarat mencantumkan pemberitahuan hak cipta asli dan penafian (disclaimer).

This project is licensed under the **MIT License**. You are free to use, modify, and distribute this code for both commercial and non-commercial purposes, provided you include the original copyright notice and disclaimer.

*Perangkat lunak ini disediakan "sebagaimana adanya", tanpa jaminan apa pun. / This software is provided "as is", without warranty of any kind.*
