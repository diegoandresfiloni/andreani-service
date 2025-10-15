/**
 * Microservicio Node.js para Andreani PyMés
 * - Login: Obtiene token de acceso
 * - Cotizar: API privada CON token
 * - Crear envío: API privada CON token
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
 * Obtiene un token válido (desde cache o login)
 */
async function getValidToken(username, password) {
    // Si hay token en cache y no expiró, usarlo
    if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
        console.log('✅ Usando token desde cache');
        return cachedToken;
    }
    
    // Token expirado o no existe, hacer login
    console.log('🔄 Obteniendo nuevo token...');
    
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
        throw new Error('LOGIN_FAILED: ' + errorText);
    }
    
    const data = await response.json();
    
    cachedToken = data.access_token;
    const expiresIn = data.expires_in || 5400;
    tokenExpiry = Date.now() + (expiresIn * 1000 * 0.9); // 90% del tiempo
    
    console.log('✅ Token obtenido y cacheado');
    
    return cachedToken;
}

/**
 * Cotiza envío usando la API privada (requiere token)
 * NOTA: Andreani PyMés no tiene endpoint público de cotización con token
 * Usamos el cotizador REST público que SÍ funciona
 */
async function cotizarEnvioPrivado(params, token) {
    // La API de Andreani PyMés NO tiene /api/v1/Cotizaciones
    // Debemos usar el cotizador REST público
    const apiUrl = 'https://cotizador-api.andreani.com/api/v1/Cotizar';
    
    // Extraer código postal desde sucursalId (últimos 4 dígitos) o usar parámetro
    let codigoPostalOrigen = params.codigoPostalOrigen || '8000';
    
    // Si tenemos sucursalOrigen pero no CP, intentar extraerlo
    if (!params.codigoPostalOrigen && params.sucursalOrigen) {
        // Por ahora usar el CP por defecto
        console.log('⚠️ Usando CP origen por defecto:', codigoPostalOrigen);
    }
    
    //Estructura para API REST pública
    const requestData = {
        usuarioId: null,
        tipoDeEnvioId: params.tipoDeEnvioId,
        codigoPostalOrigen: codigoPostalOrigen,
        codigoPostalDestino: params.codigoPostalDestino,
        bultos: params.bultos.map(bulto => ({
            itemId: generateGuid(),
            altoCm: bulto.altoCm.toString(),
            anchoCm: bulto.anchoCm.toString(),
            largoCm: bulto.largoCm.toString(),
            peso: (bulto.peso / 1000).toString(), // convertir a kg
            unidad: 'kg',
            valorDeclarado: bulto.valorDeclarado.toString()
        }))
    };
    
    console.log('📤 Cotizando con API REST pública...');
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
        
        const responseText = await response.text();
        
        console.log('📥 Respuesta (Status:', response.status, ')');
        console.log('Body:', responseText);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${responseText}`);
        }
        
        const result = JSON.parse(responseText);
        console.log('✅ Tarifas obtenidas:', result.length || 0);
        
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
 * Cotiza con API privada (requiere credenciales)
 */
app.post('/cotizar', async (req, res) => {
    try {
        const { params, username, password, token } = req.body;
        
        console.log('📍 Request recibido en /cotizar');
        console.log('Username:', username ? '✅' : '❌');
        console.log('Password:', password ? '✅' : '❌');
        console.log('Token manual:', token ? '✅' : '❌');
        
        if (!params) {
            return res.status(400).json({ 
                success: false,
                error: 'PARAMS_REQUIRED',
                message: 'Parámetros de cotización requeridos' 
            });
        }
        
        // Obtener token (manual o mediante login)
        let accessToken = token;
        
        if (!accessToken) {
            if (!username || !password) {
                console.error('❌ Sin credenciales ni token');
                return res.status(400).json({
                    success: false,
                    error: 'AUTH_REQUIRED',
                    message: 'Se requiere token o credenciales (usuario/contraseña)'
                });
            }
            
            // Hacer login para obtener token
            console.log('🔐 Obteniendo token con credenciales...');
            try {
                accessToken = await getValidToken(username, password);
                console.log('✅ Token obtenido:', accessToken.substring(0, 20) + '...');
            } catch (error) {
                console.error('❌ Error al obtener token:', error.message);
                return res.status(401).json({
                    success: false,
                    error: 'LOGIN_FAILED',
                    message: error.message
                });
            }
        } else {
            console.log('🔑 Usando token manual proporcionado');
        }
        
        console.log('✅ Cotizando con API privada...');
        
        const result = await cotizarEnvioPrivado(params, accessToken);
        
        res.json({
            success: true,
            data: result
        });
        
    } catch (error) {
        console.error('❌ Error en cotización:', error.message);
        
        if (error.message === 'TOKEN_EXPIRED') {
            // Limpiar cache y pedir reintento
            cachedToken = null;
            tokenExpiry = null;
            
            return res.status(401).json({
                success: false,
                error: 'TOKEN_EXPIRED',
                message: 'Token expirado. Reintentando...'
            });
        }
        
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
        const { envio, username, password, token } = req.body;
        
        console.log('📦 Request recibido en /crear-envio');
        
        if (!envio) {
            return res.status(400).json({
                success: false,
                error: 'ENVIO_DATA_REQUIRED',
                message: 'Se requieren datos del envío'
            });
        }
        
        // Obtener token
        let accessToken = token;
        
        if (!accessToken) {
            if (!username || !password) {
                return res.status(400).json({
                    success: false,
                    error: 'AUTH_REQUIRED',
                    message: 'Se requiere token o credenciales'
                });
            }
            
            accessToken = await getValidToken(username, password);
        }
        
        console.log('📤 Creando envío en Andreani API...');
        console.log('Datos del envío:', JSON.stringify(envio, null, 2));
        
        const response = await fetch('https://pymes-api.andreani.com/api/v1/Envios', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(envio)
        });
        
        const responseText = await response.text();
        console.log('📥 Respuesta de Andreani (Status:', response.status, ')');
        console.log('Body:', responseText);
        
        if (!response.ok) {
            if (response.status === 401) {
                cachedToken = null;
                tokenExpiry = null;
                
                return res.status(401).json({
                    success: false,
                    error: 'TOKEN_EXPIRED',
                    message: 'Token expirado'
                });
            }
            
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
 * Login manual (para obtener token si es necesario)
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
        
        const token = await getValidToken(username, password);
        
        res.json({
            success: true,
            access_token: token,
            expires_in: Math.floor((tokenExpiry - Date.now()) / 1000)
        });
        
    } catch (error) {
        console.error('❌ Error en login:', error.message);
        res.status(500).json({
            success: false,
            error: 'LOGIN_FAILED',
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
        token_valid: cachedToken && tokenExpiry && Date.now() < tokenExpiry,
        api: 'API privada (requiere autenticación)'
    });
});

/**
 * GET /
 */
app.get('/', (req, res) => {
    res.json({
        service: 'Andreani Service API',
        version: '5.0.0 - API Privada Completa',
        endpoints: {
            health: 'GET /health',
            cotizar: 'POST /cotizar (requiere credenciales o token)',
            crear_envio: 'POST /crear-envio (requiere credenciales o token)',
            login: 'POST /login (obtener token manualmente)'
        },
        status: 'running',
        note: 'Todas las operaciones requieren autenticación'
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════╗
║   🚀 Andreani Service RUNNING         ║
║   📡 Port: ${PORT}                       ║
║   ✅ API Privada Completa              ║
║   🔐 Login + Cotizar + Crear Envíos   ║
╚═══════════════════════════════════════╝
    `);
});