
// public/hash.js
self.importScripts('./md5.js')
self.onmessage = ({ data }) => {
    const chunks = data
    let size = chunks.length
    let count = 0
    const spark = new  SparkMD5.ArrayBuffer()
    const loadNext = index => {
        const reader = new FileReader()
        reader.onload = e => {
            count++
            spark.append(e.target.result)
            if (count === size) {
                self.postMessage(spark.end())
                self.close()
            } else {
                loadNext(count)
            }
        }
        reader.readAsArrayBuffer(chunks[index].chunk)
    }
    loadNext(count)
}
