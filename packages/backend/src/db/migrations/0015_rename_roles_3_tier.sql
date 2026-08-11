UPDATE users SET role = 'extern' WHERE role = 'viewer';
UPDATE users SET role = 'mitarbeiter' WHERE role = 'inspector';
UPDATE users SET role = 'admin' WHERE role IN ('project_admin', 'tenant_admin');
UPDATE users SET role = 'extern' WHERE role NOT IN ('extern', 'mitarbeiter', 'admin');
