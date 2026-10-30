import AuthForm from '../auth-form';

export default function Page() {
  return (
    <main className="auth-page">
      <section className="auth-intro" aria-labelledby="register-title">
        <p className="auth-brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="16" rx="3" />
              <path d="M7 3v4m10-4v4M3 11h18m-13 5 3 3 5-5" />
            </svg>
          </span>
          Booking B2B
        </p>
        <div>
          <p className="eyebrow">Mulai lebih teratur</p>
          <h1 id="register-title">Buat akun pelanggan</h1>
          <p>Satu akun untuk memilih layanan, memesan waktu, dan melihat kembali detail pemesanan Anda.</p>
        </div>
        <div className="auth-preview">
          <div className="preview-header">
            <strong>Dari rencana ke pemesanan</strong>
            <span>Pratinjau</span>
          </div>
          <div className="preview-row">
            <span className="preview-dot" aria-hidden="true" />
            <div><strong>Temukan layanan</strong><small>Lihat pilihan sebelum memesan</small></div>
            <span aria-hidden="true">01</span>
          </div>
          <div className="preview-row">
            <span className="preview-dot" aria-hidden="true" />
            <div><strong>Pilih jadwal</strong><small>Sesuaikan dengan waktu Anda</small></div>
            <span aria-hidden="true">02</span>
          </div>
          <div className="preview-row">
            <span className="preview-dot" aria-hidden="true" />
            <div><strong>Kelola pemesanan</strong><small>Detail tersimpan di akun Anda</small></div>
            <span aria-hidden="true">03</span>
          </div>
          <p className="auth-footnote">Ilustrasi alur pemesanan, bukan jadwal atau data aktual.</p>
        </div>
        <p className="auth-footnote">Awali dengan akun Anda. Atur pemesanan sesuai kebutuhan.</p>
      </section>
      <section className="auth-panel" aria-labelledby="register-form-title">
        <div className="auth-form-heading">
          <p className="eyebrow">Pendaftaran pelanggan</p>
          <h2 id="register-form-title">Mulai dengan akun Anda</h2>
          <p>Isi data berikut untuk membuat akun pelanggan.</p>
        </div>
        <AuthForm register />
      </section>
    </main>
  );
}
