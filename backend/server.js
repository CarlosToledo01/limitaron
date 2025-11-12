'use strict';
const express = require('express');
const bodyParser = require('body-parser');
const { generarFolio, calcularSistema, resumenLevantamiento } = require('./lib/calc');

const app = express();
app.use(bodyParser.json());

app.post('/api/v1/calculate', (req, res) => {
  try {
    const entradas = req.body || {};
    const folio = generarFolio();
    const c = calcularSistema(entradas, entradas.forcedMode || 'auto');
    const resumen = resumenLevantamiento(folio, entradas, c);
    res.json({ ok: true, folio, resumen, details: c });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Server listening on ${port}`));