/**
 * Microservicio Node.js para Andreani PyMés
 * - Cotización: API REST pública (SIN autenticación)
 * - Crear envío: API privada (CON token)
 */

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;

// Cache del token
let cachedToken = null;
let tokenExpiry = null;

/**
 * Cotiza envío usando la API REST pública
 */
async function cotizarEnvio(params) {
    const apiUrl = 'https://cotizador-api.andreani.com/api/v1/Cotizar';
    
    const requestData = {
        usuarioId: null,
        tipoDeEnvioId: params.tipoDeEnvioId,
        codigoPostalOrigen: params.codigoPostalOrigen || params.cp_origen || params.sucursalOrigen || '8000',
        codigoPostalDestino: params.codigoPostalDestino,
        bultos: params.bultos.map(bulto => ({
            itemId: generateGuid(),
            altoCm: bulto.altoCm.toString(),
            anchoCm: bulto.anchoCm.toString(),
            largoCm: bulto.largoCm.toString(),
            peso: (bulto.peso / 1000).toString(),
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
                'Accept': 'application/json',
                'xapikey': 'TEST_XqPMiwXzTRKHH0mF3gmtPtQt3LNGIuqCTdgaUHINMdmlaFid0x9MzlYTKXPxluYQ',
                'Origin': 'https://pymes.andreani.com',
                'Referer': 'https://pymes.andreani.com/cotizador'
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
        
        console.log('📍 Request recibido en /cotizar');
        
        if (!params) {
            return res.status(400).json({ 
                success: false,
                error: 'Parámetros de cotización requeridos' 
            });
        }
        
        console.log('✅ Cotizando con API REST pública...');
        
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
 * POST /crear-envio
 * Crea un envío pendiente en Andreani (requiere token)
 */
app.post('/crear-envio', async (req, res) => {
    try {
        const { token, envio } = req.body;
        
        console.log('📦 Request recibido en /crear-envio');
        
        if (!token) {
            return res.status(400).json({
                success: false,
                error: 'TOKEN_REQUIRED',
                message: 'Se requiere token de autenticación'
            });
        }
        
        if (!envio) {
            return res.status(400).json({
                success: false,
                error: 'ENVIO_DATA_REQUIRED',
                message: 'Se requieren datos del envío'
            });
        }
        
        console.log('📤 Creando envío en Andreani API...');
        console.log('Datos del envío:', JSON.stringify(envio, null, 2));
        
        const response = await fetch('https://pymes-api.andreani.com/api/v1/Envios', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(envio)
        });
        
        const responseText = await response.text();
        console.log('📥 Respuesta de Andreani (Status:', response.status, ')');
        console.log('Body:', responseText);
        
        if (!response.ok) {
            // Token expirado o inválido
            if (response.status === 401) {
                return res.status(401).json({
                    success: false,
                    error: 'TOKEN_EXPIRED',
                    message: 'Token expirado o inválido'
                });
            }
            
            // Otro error
            let errorData;
            try {
                errorData = JSON.parse(responseText);
            } catch {
                errorData = { message: responseText };
            }
            
            return res.status(response.status).json({
                success: false,
                error: 'ANDREANI_API_ERROR',
                message: 'Error de la API de Andreani',
                details: errorData
            });
        }
        
        // Parsear respuesta exitosa
        let result;
        try {
            result = JSON.parse(responseText);
        } catch {
            result = { message: 'Envío creado' };
        }
        
        console.log('✅ Envío creado exitosamente');
        console.log('Respuesta:', JSON.stringify(result, null, 2));
        
        res.json({
            success: true,
            data: result,
            message: 'Envío pendiente creado en Andreani'
        });
        
    } catch (error) {
        console.error('❌ Error al crear envío:', error.message);
        res.status(500).json({
            success: false,
            error: 'SERVER_ERROR',
            message: error.message
        });
    }
});

/**
 * POST /login
 * Login en Andreani (para obtener token si es necesario)
 */
app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        console.log('🔐 Login request para:', username);
        
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: 'CREDENTIALS_REQUIRED',
                message: 'Se requieren usuario y contraseña'
            });
        }
        
        const response = await fetch('https://pymes-api.andreani.com/api/v1/Acceso/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ Error en login:', errorText);
            return res.status(response.status).json({
                success: false,
                error: 'LOGIN_FAILED',
                message: 'Credenciales inválidas'
            });
        }
        
        const data = await response.json();
        const token = data.access_token;
        const expiresIn = data.expires_in || 5400;
        
        // Cachear el token
        cachedToken = token;
        tokenExpiry = Date.now() + (expiresIn * 1000);
        
        console.log('✅ Token obtenido y cacheado');
        
        res.json({
            success: true,
            access_token: token,
            expires_in: expiresIn
        });
        
    } catch (error) {
        console.error('❌ Error en login:', error.message);
        res.status(500).json({
            success: false,
            error: 'SERVER_ERROR',
            message: error.message
        });
    }
});

/**
 * GET /health
 */
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: Math.floor(process.uptime()),
        token_cached: cachedToken !== null,
        api: 'REST pública (cotización) + API privada (envíos)'
    });
});

/**
 * GET /
 */
app.get('/', (req, res) => {
    res.json({
        service: 'Andreani Service API',
        version: '4.0.0 - Híbrido',
        endpoints: {
            health: 'GET /health',
            cotizar: 'POST /cotizar (API pública)',
            crear_envio: 'POST /crear-envio (requiere token)',
            login: 'POST /login (obtener token)'
        },
        status: 'running',
        note: 'Cotización sin auth + Crear envío con token'
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════╗
║   🚀 Andreani Service RUNNING         ║
║   📡 Port: ${PORT}                       ║
║   ✅ API REST híbrida                 ║
║   📦 Cotizar + Crear Envíos           ║
╚═══════════════════════════════════════╝
    `);
});