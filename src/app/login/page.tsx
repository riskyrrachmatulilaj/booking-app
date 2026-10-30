import AuthForm from '../auth-form';

export default function Page() {
  return (
    <main className="auth-page">
      <section className="auth-intro" aria-labelledby="login-title">
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
          <p className="eyebrow">Jadwal lebih tertata</p>
          <h1 id="login-title">Masuk ke Booking B2B</h1>
          <p>Pilih layanan, temukan waktu yang sesuai, dan kelola pemesanan Anda dalam satu tempat.</p>
        </div>
        <div className="auth-preview">
          <div className="preview-header">
            <strong>Gambaran jadwal Anda</strong>
            <span>Pratinjau</span>
          </div>
          <div className="preview-row">
            <span className="preview-dot" aria-hidden="true" />
            <div><strong>Pilih layanan</strong><small>Temukan layanan yang Anda butuhkan</small></div>
            <span aria-hidden="true">01</span>
          </div>
          <div className="preview-row">
            <span className="preview-dot" aria-hidden="true" />
            <div><strong>Tentukan waktu</strong><small>Pilih dari jadwal yang tersedia</small></div>
            <span aria-hidden="true">02</span>
          </div>
          <div className="preview-row">
            <span className="preview-dot" aria-hidden="true" />
            <div><strong>Lihat pemesanan</strong><small>Periksa detail melalui akun Anda</small></div>
            <span aria-hidden="true">03</span>
          </div>
          <p className="auth-footnote">Ilustrasi alur pemesanan, bukan jadwal atau data aktual.</p>
        </div>
        <p className="auth-footnote">Lebih sedikit urusan jadwal. Lebih banyak waktu untuk Anda.</p>
      </section>
      <section className="auth-panel" aria-labelledby="login-form-title">
        <div className="auth-form-heading">
          <p className="eyebrow">Akun Anda</p>
          <h2 id="login-form-title">Selamat datang kembali</h2>
          <p>Masukkan email dan kata sandi untuk melanjutkan.</p>
        </div>
        <AuthForm />
      </section>
    </main>
  );
}
