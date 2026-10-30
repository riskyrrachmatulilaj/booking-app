import React from 'react';
import { createRoot } from 'react-dom/client';
import AppointmentList from '../../src/components/appointment-list';
import StaffEditor from '../../src/components/staff-editor';
import '../../src/app/globals.css';
const params = new URLSearchParams(location.search);
createRoot(document.getElementById('root')!).render(<main className="workspace">{params.has('team') ? <StaffEditor /> : <AppointmentList role={params.get('role') === 'staff' ? 'staff' : 'customer'} />}</main>);
