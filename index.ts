/**
 * 全局变量.
 */

/** 是否重新建立数据库表. */
const forceSync = false

/** JWT 使用的密钥. */
const secretKey = 'sbhwjcnm'

import types from './types.js'

/**
 * 外部库设定.
 */

// express-jwt 是 express 使用的 JWT 中间件.
import jwt from 'jsonwebtoken'
import { expressjwt } from 'express-jwt'
const auth = expressjwt({
  secret: secretKey,
  algorithms: ['HS256'],
  getToken: req => req.headers.authorization || null,
}).unless({ path: ['/login', '/map'] })

// express 是后端框架.
import express, { Request, Response } from 'express'
const app = express()
app.use(express.json())
app.use('/public', express.static('./public'))
app.use(auth)

// sequelize 是 ORM 库.
import { Sequelize, Op, DataTypes, Model } from 'sequelize'
const sequelize = new Sequelize({
  host: 'localhost',
  username: 'root',
  password: '114514',
  database: 'mshd',
  dialect: 'mysql',
  timezone: 'Asia/Shanghai',
})

// axios 用于发送网络请求.
import { Axios } from 'axios'
const axios = new Axios({})

// formidable 用于解析 form-data.
import formidable from 'formidable'

// jimp 用于图像处理.
import jimp from 'jimp'

// dayjs 用于日期格式化.
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone.js'
dayjs.extend(timezone)

/**
 * 数据库模式定义.
 */

const IdAttribute = {
  type: DataTypes.INTEGER,
  allowNull: false,
  autoIncrement: true,
  primaryKey: true,
}

const User = sequelize.define('User', {
  id: IdAttribute,
  name: DataTypes.TEXT('tiny'),
  password: DataTypes.TEXT,
})

const Star = sequelize.define('Star', {})

const Message = sequelize.define('Message', {
  id: IdAttribute,
  description: DataTypes.TEXT,
  lng: DataTypes.DOUBLE,
  lat: DataTypes.DOUBLE,
  time: DataTypes.DATE,
})

const Attachment = sequelize.define('Attachment', {
  id: IdAttribute,
  fileName: DataTypes.TEXT,
})

const MessageDatum = sequelize.define('MessageDatum', {
  id: IdAttribute,
  area: { type: DataTypes.TEXT, allowNull: false },
  type: { type: DataTypes.INTEGER, allowNull: false },
  date: { type: DataTypes.DATE, allowNull: false },
})

const Event = sequelize.define('Event', {
  id: IdAttribute,
  name: { type: DataTypes.TEXT, allowNull: false },
})

User.hasMany(Star)
Star.belongsTo(User)

Message.hasMany(Star)
Star.belongsTo(Message)

Message.hasMany(Attachment)
Attachment.belongsTo(Message)

Message.belongsTo(MessageDatum)
MessageDatum.hasMany(Message)

MessageDatum.belongsTo(Event)
Event.hasMany(MessageDatum)

await sequelize.sync({ force: forceSync })
console.log('服务器已开启.')

/**
 * 工具函数.
 */

async function getArea(lng?: number, lat?: number): Promise<string> {
  if (!lng || !lat) return '未知区域'
  const request = await axios.get(
    'https://restapi.amap.com/v3/geocode/regeo?key=37c1a3bbd62eb2f8335982ad5efdfd7b' +
      `&location=${lng.toFixed(6)},${lat.toFixed(6)}`,
    { transformResponse: [data => (data ? JSON.parse(data) : {})] },
  )
  // console.log(request.data)
  if (request.status !== 200 || request.data.status !== '1') return '未知区域'
  const province = request.data.regeocode.addressComponent.province
  if (typeof province === 'string') return province
  return '未知区域'
}

function getDate(time: Date) {
  return dayjs(time, 'Asia/Shanghai').format('YYYY-MM-DD 00:00:00')
}

async function getMessage(id: number, user: Model) {
  const message = await Message.findByPk(id, {
    include: [MessageDatum, Attachment],
  })
  const relation = (message as any).MessageDatum as typeof message
  const attachments = (message as any).Attachments as (typeof message)[]

  const { createdAt, description, lng, lat, time } = message.dataValues
  const { area, type, EventId } = relation.dataValues
  const fileNames = attachments.map(attachment => attachment.dataValues.fileName)

  const event = await Event.findByPk(EventId)
  const eventName = event.dataValues.name

  const star = await Star.count({ where: { UserId: user.dataValues.id, MessageId: id } })

  return {
    id,
    createdAt,
    description,
    lng,
    lat,
    area,
    type,
    time,
    eventId: EventId,
    eventName,
    fileNames,
    star: !!star,
  }
}

async function getAuthUser(request: Request, response: Response) {
  const { name } = (request as any).auth
  const user = await User.findOne({ where: { name } })
  if (user === null) response.status(401).send({ status: 'failed', message: '用户不存在。' })
  return user
}

app.get('/page/home', async (request, response) => {
  if (!(await getAuthUser(request, response))) return

  const today = { createdAt: { [Op.gt]: getDate(new Date()) } }
  const todayMessages = await Message.findAll({ where: today, limit: 20 })

  response.send({
    status: 'success',
    totalEvents: await Event.count(),
    totalMessages: await Message.count(),
    todayMessages: await Message.count({ where: today }),
    todayCoords: todayMessages.map(message => [message.dataValues.lng, message.dataValues.lat]),
  })
})

app.get('/page/messages', async (request, response) => {
  const user = await getAuthUser(request, response)
  if (!user) return

  const filter = request.query.filter === 'true'
  const page = typeof request.query.page === 'string' ? parseInt(request.query.page) || 0 : 0
  const EventId =
    typeof request.query.eventId === 'string'
      ? parseInt(request.query.eventId) || undefined
      : undefined
  const UserId = user.dataValues.id as number

  const include = [
    { model: MessageDatum, where: EventId ? { EventId } : undefined },
    { model: Star, where: filter ? { UserId } : undefined },
  ]

  const count = await Message.count({ include })
  const messages = await Message.findAll({
    include,
    order: [['createdAt', 'DESC']],
    limit: 10,
    offset: page * 10,
  })

  const ids = messages.map(message => message.dataValues.id)

  response.send({
    status: 'success',
    messages: await Promise.all(ids.map(id => getMessage(id, user))),
    messageData: EventId
      ? await MessageDatum.findAll({ where: { EventId }, order: [['createdAt', 'DESC']] })
      : undefined,
    maxPage: Math.ceil(count / 10),
  })
})

app.get('/page/events', async (request, response) => {
  if (!(await getAuthUser(request, response))) return

  const page = typeof request.query.page === 'string' ? parseInt(request.query.page) || 0 : 0

  const count = await Event.count()
  const events = await Event.findAll({
    order: [['createdAt', 'DESC']],
    limit: 20,
    offset: page * 20,
  })

  response.send({
    status: 'success',
    events,
    maxPage: Math.ceil(count / 20),
  })
})

app.post('/login', async (request, response) => {
  const name = request.body.name
  const password = request.body.password

  if (!name || !password)
    return response.status(403).send({ status: 'failed', message: '请输入用户名与密码。' })

  const user = await User.findOne({ where: { name } })

  if (user !== null) {
    if (user.dataValues.password !== password)
      return response.status(403).send({ status: 'failed', message: '密码错误。' })
  } else {
    await User.create({ name, password })
  }

  const token = jwt.sign({ name }, secretKey)
  return response.send({ status: 'success', token })
})

app.post('/message', async (request, response) => {
  if (!(await getAuthUser(request, response))) return

  const form = formidable({
    multiples: true,
    uploadDir: './public/images',
    keepExtensions: true,
  })

  try {
    const [fields, files] = await form.parse(request)
    const fileList = files.file ?? []
    // console.log(fields, files)

    const fileValid = fileList.every(file => {
      const extName = file.mimetype.split('/')[1]
      console.log(extName)
      const size = file.size / 1024 / 1024
      return ['jpeg', 'jpg', 'png'].includes(extName) && size <= 10
    })
    if (!fileValid)
      return response.send({
        status: 'failed',
        message: '只能上传 JPEG 或 PNG 格式且不超过 10 MiB 的图片。',
      })

    const description = fields.description?.[0]
    const _lng = fields.lng?.[0]
    const _lat = fields.lat?.[0]
    const _type = fields.type?.[0]
    const _time = fields.time?.[0]

    const lng = parseFloat(_lng) || undefined
    const lat = parseFloat(_lat) || undefined
    const timestamp = new Date(_time).getTime()
    const time = timestamp && timestamp <= Date.now() ? new Date(_time) : new Date()

    const area = await getArea(lng, lat)
    const date = getDate(time)
    const type = parseInt(_type) || 0

    let relation = await MessageDatum.findOne({ where: { area, date, type } })
    if (relation === null) {
      const event = await Event.create({ name: `${date.slice(0, 10)} ${area}${types[type]}` })
      const EventId = event.dataValues.id
      relation = await MessageDatum.create({ area, date, type, EventId })
    }
    const MessageDatumId = relation.dataValues.id

    const message = await Message.create({ description, lng, lat, time, MessageDatumId })
    const MessageId = message.dataValues.id

    for (const file of fileList) {
      const img = await jimp.read(file.filepath)
      img.cover(128, 128).write(`./public/thumbnails/${file.newFilename}`)
      await Attachment.create({ fileName: file.newFilename, MessageId })
    }

    response.send({
      status: 'success',
    })
  } catch (error) {
    response.status(500).send({
      status: 'failed',
      message: '服务器内部错误。',
    })
  }
})

app.post('/star', async (request, response) => {
  const user = await getAuthUser(request, response)
  if (!user) return

  const MessageId = request.body.id
  if (typeof MessageId !== 'number') return response.status(403).send({ status: 'failed' })

  const UserId = user.dataValues.id as number
  const state = request.body.state as boolean

  const [star] = await Star.findOrCreate({ where: { UserId, MessageId } })
  if (state === false) await star.destroy()
  return response.send({ status: 'success', state: state })
})

app.post('/messageData', async (request, response) => {
  if (!(await getAuthUser(request, response))) return

  const { area, date, type } = request.body
  if (typeof area !== 'string' || typeof date !== 'number' || typeof type !== 'number')
    return response.status(403).send({ status: 'failed', message: '' })

  const [relation] = await MessageDatum.findOrCreate({
    where: { area, date: getDate(new Date(date)), type },
  })
  const prevId = relation.dataValues.EventId

  let id = request.body.id
  if (typeof id !== 'number') {
    const count = await MessageDatum.count({ where: { EventId: prevId } })
    if (count === 1) return response.send({ status: 'success' })

    const event = await Event.create({
      name: `${getDate(new Date(date)).slice(0, 10)} ${area}${types[type]}`,
    })
    id = event.dataValues.id
  }

  relation.set('EventId', id)
  await relation.save()

  if (prevId) {
    const count = await MessageDatum.count({ where: { EventId: prevId } })
    if (count === 0) await Event.destroy({ where: { id: prevId } })
  }

  return response.send({ status: 'success' })
})

app.post('/event', async (request, response) => {
  if (!(await getAuthUser(request, response))) return

  const { id, name } = request.body
  if (typeof id !== 'number' || typeof name !== 'string')
    return response.status(403).send({ status: 'failed', message: '请输入灾情名称。' })

  await Event.update({ name }, { where: { id } })
  return response.send({ status: 'success' })
})

app.listen(1919)
