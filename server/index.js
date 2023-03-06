const path = require("path");
const fse = require("fs-extra");
const multiparty = require("multiparty");
const express = require("express");
const bodyParser = require('body-parser')
const formidable = require('express-formidable')

const app = express()

const UPLOAD_DIR = path.resolve(__dirname, "..", "files"); // 大文件存储目录
const CHUNKS_DIR = path.resolve(__dirname, "..", "chunks"); // 大文件存储目录
const getFilePath = (name) => {
    return path.resolve(UPLOAD_DIR, name)
}
const getChunkPath = (...names) => {
    return path.resolve(CHUNKS_DIR, ...names)
}
// const multipart = new multiparty.Form();

// multipart.parse(req, async (err, fields, files) => {
//     if (err) {
//         return;
//     }
//     const [chunk] = files.chunk;
//     const [hash] = fields.hash;
//     const [filename] = fields.filename;
//     const chunkDir = path.resolve(UPLOAD_DIR, filename);

//     // 切片目录不存在，创建切片目录
//     if (!fse.existsSync(chunkDir)) {
//         await fse.mkdirs(chunkDir);
//     }

//     // fs-extra 专用方法，类似 fs.rename 并且跨平台
//     // fs-extra 的 rename 方法 windows 平台会有权限问题
//     // https://github.com/meteor/meteor/issues/7852#issuecomment-255767835
//     await fse.move(chunk.path, `${chunkDir}/${hash}`);
//     res.end("received file chunk");
// });

app.use(formidable())
// app.use(bodyParser.urlencoded({ extended: false }))
// app.use(bodyParser.json())
app.use(express.static('chunks'))

app.all("/*", function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "*");
    res.header("Access-Control-Allow-Methods", "*");
    next();
});


app.post('/verify', (req, res, next) => {
    const { hash, name } = req.fields
    console.log(getFilePath(`${hash}${extractExt(name)}`))
    fse.pathExists(getFilePath(`${hash}${extractExt(name)}`), (error, exist) => {
        if (exist) {
            return res.status(200).json({ shouldUpload: false })
        }
        fse.readdir(getChunkPath(hash), (err, dir) => {
            if (err) {
                return res.status(200).json({ shouldUpload: true, uploadedList: [] })
            }
            return res.status(200).json({ shouldUpload: true, uploadedList: dir })
        })
    })
})

app.post('/upload', (req, res, next) => {
    const { fileName, fileHash, hash } = req.fields
    const { chunk } = req.files
    fse.ensureDir(getChunkPath(fileHash), (error, exist) => {
        fse.move(chunk.path, getChunkPath(fileHash, hash))
            .then(() => {
                res.status(200).json({ code: 200 })
            })
    })
})

app.post('/merge', async (req, res, next) => {
    const { fileName, fileHash, size } = req.fields
    const filePath = getFilePath(`${fileHash}${extractExt(fileName)}`)
    // 如果大文件已经存在，则直接返回
    if (fse.existsSync(filePath)) {
        res.end(
            JSON.stringify({
                code: 0,
                message: 'file merged success'
            })
        )
        return
    }
    const chunksPath = getChunkPath(fileHash)
    // 切片目录不存在，则无法合并切片，报异常
    if (!fse.existsSync(chunksPath)) {
        res.end(
            JSON.stringify({
                code: 500,
                message: '文件上传失败-切片文件夹不存在'
            })
        )
        return
    }
    await mergeFileChunk(filePath, fileHash)
    res.end(
        JSON.stringify({
            code: 0,
            message: 'file merged success'
        })
    )
})

const mergeFileChunk = async (filePath, fileHash) => {
    // 所有的文件切片放在以“大文件-文件hash命名文件夹”中
    const chunkDir = getChunkPath(fileHash)
    const chunkPaths = await fse.readdir(chunkDir)
    // 根据切片下标进行排序
    // 否则直接读取目录的获得的顺序可能会错乱
    chunkPaths.sort((a, b) => a - b)
    await Promise.all(
        chunkPaths.map((chunkPath, index) => {
            return pipeStream(
                path.resolve(chunkDir, chunkPath),
                /**
                 * 创建写入的目标文件的流，并指定位置，
                 * 目的是能够并发合并多个可读流到可写流中，这样即使流的顺序不同也能传输到正确的位置，
                 * 所以这里还需要让前端在请求的时候多提供一个 size 参数。
                 * 其实也可以等上一个切片合并完后再合并下个切片，这样就不需要指定位置，
                 * 但传输速度会降低，所以使用了并发合并的手段，
                 */
                fse.createWriteStream(filePath, {
                    start: index * 1024 * 1024,
                    end: (index + 1) * 1024 * 1024
                })
            )
        })
    )

    // 文件合并后删除保存切片的目录
    fse.rmdirSync(chunkDir)
}

const extractExt = filename => {
    return filename.slice(filename.lastIndexOf('.'), filename.length)
}

const pipeStream = (path, writeStream) => {
    return new Promise((resolve, reject) => {
        // 创建可读流
        const readStream = fse.createReadStream(path)
        // 设置编码为 utf8。
        // readerStream.setEncoding('二进制')
        // 处理流事件 --> data, end, and error
        readStream.on('end', () => {
            fse.unlinkSync(path)
            resolve()
        })
        readStream.pipe(writeStream)
    })
}

app.post('/cancel', (req, res) => {
    const { hash } = req.fields
    console.log(getChunkPath(hash))
    fse.rmdirSync(getChunkPath(hash))
    res.status(200).json({
        code: 200
    })
})

app.listen(3000, () => console.log("正在监听 3000 端口"));