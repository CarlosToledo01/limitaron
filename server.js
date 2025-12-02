'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

// RESOLVER calc.js con ruta absoluta + log de verificación
const calcPath = path.join(__dirname, 'backend', 'lib', 'calc.js');
console.log('[BOOT] __dirname =', __dirname);
console.log('[BOOT] Looking for calc at:', calcPath, 'exists:', fs.existsSync(calcPath));

const { calcularSistema, resumenLevantamiento } = require(calcPath);

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const app = express();

app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use('/api/', rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
}));

app.post('/api/v1/calculate', (req, res) => {
  try {
    const payload = req.body || {};
    const forcedMode = String(payload.forcedMode || 'auto');
    const sistemaObj = calcularSistema(payload, forcedMode);
    const resumen = resumenLevantamiento(
      sistemaObj.folio,
      {
        Focos: payload.Focos,
        Contactos: payload.Contactos,
        Bombas: payload.Bombas,
        ContactosEspeciales: payload.ContactosEspeciales
      },
      sistemaObj
    );
    res.json({ ok: true, sistema: sistemaObj, resumen });
  } catch (err) {
    console.error('Error en /api/v1/calculate', err);
    res.status(500).json({ ok: false, error: err.message || 'Error interno' });
  }
});

app.get('/api/v1/health', (req, res) => {
  res.json({ ok: true, status: 'UP', ts: Date.now() });
});

const webDir = path.join(__dirname, 'web');
app.use(express.static(webDir));
app.get('*', (req, res) => {
  res.sendFile(path.join(webDir, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`LIMATRON escuchando en http://${HOST}:${PORT} (NODE_ENV=${process.env.NODE_ENV || 'dev'})`);
});
