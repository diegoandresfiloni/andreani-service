/**
 * Microservicio Node.js para Andreani PyMés
 * Usando API REST pública - SIN WebSocket, SIN autenticación
 */

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;

/**
 * Cotiza envío usando la API REST pública
 */
async function cotizarEnvio(params) {
    const apiUrl = 'https://cotizador-api.andreani.com/api/v1/Cotizar';
    
    const requestData = {
        usuarioId: null, // API pública no necesita usuario
        tipoDeEnvioId: params.tipoDeEnvioId,
        codigoPostalOrigen: params.codigoPostalOrigen || params.sucursalOrigen,
        codigoPostalDestino: params.codigoPostalDestino,
        bultos: params.bultos.map(bulto => ({
            itemId: generateGuid(),
            altoCm: bulto.altoCm.toString(),
            anchoCm: bulto.anchoCm.toString(),
            largoCm: bulto.largoCm.toString(),
            peso: (bulto.peso / 1000).toString(), // Convertir gramos a kg
            unidad: 'kg',
            valorDeclarado: bulto.valorDeclarado.toString()
        }))
    };
    
    console.log('📤 Enviando a Andreani API REST...');
    console.log('URL:', apiUrl);
    console.log('Request:', JSON.stringify(requestData, null, 2));
    
    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(requestData)
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        console.log('📥 Respuesta recibida de Andreani');
        console.log('Tarifas:', JSON.stringify(result, null, 2));
        
        return result;
        
    } catch (error) {
        console.error('❌ Error en cotización:', error.message);
        throw error;
    }
}

/**
 * Genera un GUID para itemId
 */
function generateGuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// ============================================
// ENDPOINTS
// ============================================

/**
 * POST /cotizar
 * Cotiza un envío usando la API REST pública
 */
app.post('/cotizar', async (req, res) => {
    try {
        const { params } = req.body;
        
        console.log('🔍 Request recibido en /cotizar');
        
        if (!params) {
            return res.status(400).json({ 
                success: false,
                error: 'Parámetros de cotización requeridos' 
            });
        }
        
        console.log('✅ Cotizando con API REST pública...');
        
        // Cotizar usando API REST
        const result = await cotizarEnvio(params);
        
        res.json({
            success: true,
            data: result
        });
        
    } catch (error) {
        console.error('❌ Error en cotización:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /health
 */
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        api: 'REST pública - Sin autenticación'
    });
});

// Ruta raíz
app.get('/', (req, res) => {
    res.json({
        service: 'Andreani Service API',
        version: '3.0.0 - REST API pública',
        endpoints: {
            health: 'GET /health',
            cotizar: 'POST /cotizar'
        },
        status: 'running',
        note: 'Usando API REST pública de Andreani - Sin WebSocket ni autenticación'
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════╗
║   🚀 Andreani Service RUNNING         ║
║   📡 Port: ${PORT}                       ║
║   ✅ API REST pública - 100% estable  ║
╚═══════════════════════════════════════╝
    `);
});