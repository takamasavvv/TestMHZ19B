var Obniz = require("obniz");
var obniz = new Obniz("8395-0932");

//Sensor GND : 0
//Sensor GND : 1
//obniz Tx out : 2
//obniz Rx in : 3
const GND = false;
const VCC = true;
const tx_out = 2;
const rx_in = 3;

txbuf = new Buffer.alloc(9);//送信バッファ
rxbuf = new Buffer.alloc(9);//受信バッファ

const sample_interval = 1500;//サンプリング間隔
const smple_wait = 300000 / sample_interval;
var rx_count = 0;

var initValue = {
    'Calibration' : false,
    'Range' : 5000,
    'ABC' : true
}

const modetype = {//送信コマンド種類
    'Read': 0x86,
    'CalibZ': 0x87,
    'CalibS': 0x88,
    'ABCOnOff': 0x79,
    'RangeSet': 0x99
};
const rangetype = {//range 設定
    2000 : [0x00, 0x00, 0x00, 0x07, 0xD0],
    5000 : [0x00, 0x00, 0x00, 0x13, 0x88],
    10000 : [0x00, 0x00, 0x00, 0x27, 0x10]
}

obniz.onconnect = async function() {
    obniz.io0.output(GND);
    obniz.io1.output(VCC);

    mhz19b = obniz.getFreeUart();
    await mhz19b.start({ tx: tx_out, rx: rx_in, baud: 9600 });
    
    setInterval(async function(){
        requestConcentraiton();
        await mhz19b.send(txbuf);
    }, sample_interval);

    mhz19b.onreceive = (data, text) => {
        readCO2Concentration(data);
    }

    obniz.switch.onchange = async function(state) {
        if(state == "push"){
            if (initValue['Calibration']) {
                calibrationZero();
                await mhz19b.send(txbuf);
                calibrationSpan(2000);
                await mhz19b.send(txbuf);
                rx_count = 0;
            }
            
            configABC(initValue['ABC']);
            await mhz19b.send(txbuf);

            configRange(initValue['Range']);
            await mhz19b.send(txbuf);
        }
    };

};

//チェックサム
function checkSum(res8) {
    let sum = 0;
    for (let i = 1; i < 8; i++) {
        sum += res8[i];
    }
    sum = (255 - (sum % 256)) + 1;
    return sum;
}

//送信コマンドの作成
function makeRequestCmd(mode, databox = [0x00, 0x00, 0x00, 0x00, 0x00]) {
    txbuf[0] = 0xFF;
    txbuf[1] = 0x01;
    txbuf[2] = modetype[mode];
    for (let i = 3; i < 8; i++) {
        txbuf[i] = databox[i - 3];
    }
    txbuf[8] = checkSum(txbuf);
}

//受信データのチェック
function checkResponseData(data) {
    let cs_result = false; //checksum 結果　成功の時 : true
    if (data.length == 9) {
        for (let i = 0; i < data.length; i++) {
            rxbuf[i] = data[i];
        }
        if(checkSum(rxbuf) == rxbuf[8]) {
            cs_result = true;
        } else {
            cs_result = false;
        }
    }
    data = [];
    return cs_result;
}

//CO2濃度取得（失敗時は0を返す。）
function readCO2Concentration(data) {
    let co2_con = 0;
    let status = checkResponseData(data);
    if(status)//checksum成功
    {
        //起動後はしばらく値が変動しない（サンプリングされてない？）ので余裕をもって5分間待つ
        if(rx_count > smple_wait) {
            co2_con = rxbuf[2] * 256 + rxbuf[3];
            obniz.display.clear();
            obniz.display.print(String(co2_con) + "[ppm]");
        } else {
            rx_count ++;
            obniz.display.clear();
            obniz.display.print("preparing... :");
            obniz.display.print(String(smple_wait + 1 - rx_count));
        }
    } else {
        obniz.display.clear();
        obniz.display.print("error");
    }
    rxbuf = [];
    return co2_con;
}

function requestConcentraiton() {
    makeRequestCmd('Read', [0x00, 0x00, 0x00, 0x00, 0x00]);
}

function calibrationZero(){//zero point calibration
    obniz.display.clear();
    obniz.display.print("Calibrate Zero");
    makeRequestCmd('CalibZ', [0x00, 0x00, 0x00, 0x00, 0x00]);
}
function calibrationSpan(span){
    //{span}
    //recommend : 2000[ppm]
    //at least  : 1000[ppm]
    //{calibration procedure}
    //zero point -> span point
    let span_byte = new Buffer.alloc(2);
    span_byte[0] = span / 256;
    span_byte[1] = span % 256;
    obniz.display.clear();
    obniz.display.print("Calibrate Span");
    makeRequestCmd('CalibS', [span_byte[0], span_byte[1], 0x00, 0x00, 0x00]);
}
function configABC(abc = true){
    let data = [];
    if (!abc) {//ABC off
        makeRequestCmd('ABCOnOff', [0x00, 0x00, 0x00, 0x00, 0x00]);
        obniz.display.clear();
        obniz.display.print("Configured ABC OFF");
    } else {//ABC on
        makeRequestCmd('ABCOnOff', [0xA0, 0x00, 0x00, 0x00, 0x00]);
        obniz.display.clear();
        obniz.display.print("Configured ABC ON");
    }

}

function configRange(range){//rangeは2000/5000/(10000?)から選択
    if(range in rangetype){
        makeRequestCmd('RangeSet', rangetype[range]);
        obniz.display.clear();
        obniz.display.print("Configured Range : " + String(range));
    } else {
        console.log("invalid range value")
        makeRequestCmd('RangeSet', rangetype[5000]);
    }
}
