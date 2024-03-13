import mime from 'mime-types'
import { IGofletConfig, IOldReqOptionsWithFullResponse, IPicGo, IPluginConfig } from '../../types'
import { ILocalesKey } from '../../i18n/zh-CN'
import path from 'path'
import { URLSearchParams } from 'node:url'
import * as jwt from 'jsonwebtoken'

const generateJWT = (options: IGofletConfig, fileName: string, upload: boolean): string => {
  fileName = fileName.replace(/\\/g, '/')
  const basePath = options.path
  const header = {
    alg: options.jwtAlgorithm,
    typ: 'JWT'
  }
  const payload = {
    iss: options.jwtIssuer,
    iat: Math.floor(Date.now() / 1000),
    nbf: Math.floor(Date.now() / 1000),
    permissions: [] as any[]
  }
  if (upload) {
    payload.permissions.push({
      path: path.join('/file/', basePath, fileName).replace(/\\/g, '/'),
      methods: ['POST']
    })
  } else {
    const queryMap = {} as any;
    (new URLSearchParams(options.defaultOptions)).forEach((value, key) => {
      queryMap[key] = value
    })
    payload.permissions.push({
      path: path.join('/api/image/', basePath, fileName).replace(/\\/g, '/'),
      methods: ['GET'],
      query: queryMap
    })
  }
  try {
    // @ts-expect-error
    return jwt.sign(payload, options.jwtSecret, { header, algorithm: options.jwtAlgorithm })
  } catch (e) {
    // console.error('[Goflet] JWT token generation failed: ', e)
    return ''
  }
}

const postOptions = (options: IGofletConfig, fileName: string, jwtToken: string, image: Buffer): IOldReqOptionsWithFullResponse => {
  const filePath = options.path
  return {
    method: 'POST',
    url: `${options.endpoint}/file/${path.join(filePath, fileName).replace(/\\/g, '/')}`,
    headers: {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      Host: `${(new URL(options.endpoint)).hostname}`,
      Authorization: `Bearer ${jwtToken}`,
      contentType: 'multipart/form-data',
      'User-Agent': 'PicGo'
    },
    formData: {
      file: {
        value: image,
        options: {
          filename: fileName,
          contentType: mime.lookup(fileName)
        }
      }
    },
    resolveWithFullResponse: true
  }
}

const handle = async (ctx: IPicGo): Promise<IPicGo | boolean> => {
  const gofletOptions = ctx.getConfig<IGofletConfig>('picBed.goflet')
  if (!gofletOptions) {
    throw new Error('Can\'t find goflet options')
  }
  const imgList = ctx.output
  const path = gofletOptions.path.replace(/\\/g, '/').replace(/^\//, '').replace(/\/$/, '')
  for (const img of imgList) {
    if (img.fileName && img.buffer) {
      const jwtToken = generateJWT(gofletOptions, img.fileName, true)
      // console.log(jwtToken)
      if (!jwtToken) {
        return false
      }
      let image = img.buffer
      if (!image && img.base64Image) {
        image = Buffer.from(img.base64Image, 'base64')
      }
      const options = postOptions(gofletOptions, img.fileName, jwtToken, image)
      const res = await ctx.request(options)
        .then((res: any) => res)
        .catch((err: Error) => {
          return {
            statusCode: 400,
            body: {
              msg: ctx.i18n.translate<ILocalesKey>('AUTH_FAILED'),
              err
            }
          }
        })
      // console.log(res)
      try {
        if (res.statusCode === 400) {
          const body = JSON.parse(res?.body)
          throw new Error(body?.error || ctx.i18n.translate<ILocalesKey>('AUTH_FAILED'))
        }
        if (res.statusCode === 201) {
          delete img.base64Image
          delete img.buffer
          img.imgUrl = `${gofletOptions.endpoint}/api/image/${path}/${img.fileName.replace(/\\/g, '/')}`
          const searchParams = new URLSearchParams(gofletOptions.defaultOptions)
          const visitJwt = generateJWT(gofletOptions, img.fileName, false)
          searchParams.set('token', visitJwt)
          img.imgUrl += `?${searchParams.toString()}`
        } else {
          const body = JSON.parse(res?.body)
          throw new Error(body?.error || ctx.i18n.translate<ILocalesKey>('SERVER_ERROR'))
        }
      } catch (e) {
        // console.error(e)
        throw new Error(ctx.i18n.translate<ILocalesKey>('SERVER_ERROR'))
      }
    }
  }
  return ctx
}

const config = (ctx: IPicGo): IPluginConfig[] => {
  const userConfig = ctx.getConfig<IGofletConfig>('picBed.goflet') || {}
  return [
    {
      name: 'jwtAlgorithm',
      type: 'list',
      alias: ctx.i18n.translate<ILocalesKey>('PICBED_GOFLET_JWT_ALGORITHM'),
      choices: ['None', 'HS256', 'HS384', 'HS512', 'RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512', 'PS256', 'PS384', 'PS512'],
      default: 'HS256',
      required: false
    },
    {
      name: 'jwtSecret',
      type: 'input',
      get alias () {
        return ctx.i18n.translate<ILocalesKey>('PICBED_GOFLET_JWT_SECRET')
      },
      default: userConfig.jwtSecret || '',
      required: true
    },
    {
      name: 'jwtIssuer',
      type: 'input',
      get alias () {
        return ctx.i18n.translate<ILocalesKey>('PICBED_GOFLET_JWT_ISSUER')
      },
      default: userConfig.jwtIssuer || 'picgo',
      required: false
    },
    {
      name: 'endpoint',
      type: 'input',
      get prefix () {
        return ctx.i18n.translate<ILocalesKey>('PICBED_GOFLET_ENDPOINT')
      },
      get alias () {
        return ctx.i18n.translate<ILocalesKey>('PICBED_GOFLET_ENDPOINT')
      },
      default: userConfig.endpoint || '',
      get message () {
        return ctx.i18n.translate<ILocalesKey>('PICBED_GOFLET_MESSAGE_ENDPOINT')
      },
      required: true
    },
    {
      name: 'path',
      type: 'input',
      get prefix () {
        return ctx.i18n.translate<ILocalesKey>('PICBED_GOFLET_PATH')
      },
      get alias () {
        return ctx.i18n.translate<ILocalesKey>('PICBED_GOFLET_PATH')
      },
      default: userConfig.path || '',
      get message () {
        return ctx.i18n.translate<ILocalesKey>('PICBED_GOFLET_MESSAGE_PATH')
      },
      required: false
    },
    {
      name: 'defaultOptions',
      type: 'input',
      get prefix () {
        return ctx.i18n.translate<ILocalesKey>('PICBED_GOFLET_OPTIONS')
      },
      get alias () {
        return ctx.i18n.translate<ILocalesKey>('PICBED_GOFLET_OPTIONS')
      },
      default: userConfig.defaultOptions || '',
      get message () {
        return ctx.i18n.translate<ILocalesKey>('PICBED_GOFLET_MESSAGE_OPTIONS')
      },
      required: false
    }
  ]
}

export default function register (ctx: IPicGo): void {
  ctx.helper.uploader.register('goflet', {
    get name () {
      return ctx.i18n.translate<ILocalesKey>('PICBED_GOFLET')
    },
    handle,
    config
  })
}
