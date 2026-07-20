# FBA STA 目标仓测试说明

## 已记录的领星店铺 SID

| 领星店铺 | 国家/站点 | SID | BI显示 |
| --- | --- | ---: | --- |
| tandanbo-AU | 澳洲 | 11503 | 坦蛋伯澳洲 |
| xiamentanjia-US | 美国 | 8708 | 探嘉美国 |
| xiamentanjia-CA | 加拿大 | 8709 | 探嘉加拿大 |
| xiamentanjia-MX | 墨西哥 | 8710 | 探嘉墨西哥 |
| tandanbo-US | 美国 | 11500 | 坦蛋伯美国 |
| tandanbo-CA | 加拿大 | 11501 | 坦蛋伯加拿大 |
| tandanbo-MX | 墨西哥 | 11502 | 坦蛋伯墨西哥 |
| tandanbo-BR | 巴西 | 14527 | 坦蛋伯巴西 |
| xiamentanjia-AU | 澳洲 | 11499 | 探嘉澳洲 |

## 测试接口

```text
POST /api/fba/sta/warehouse-probe
```

这个接口会：

1. 创建 STA 任务。
2. 查询创建任务状态。
3. 生成货件方案。
4. 查询货件方案。
5. 提取 `wareHouseId`。
6. 默认取消这次 STA 任务，避免留下无用任务。
7. 如果配置了 `FBA_DINGTALK_WEBHOOK`，会发送钉钉通知。

## 测试请求示例

```bash
curl -s -X POST http://127.0.0.1:4173/api/fba/sta/warehouse-probe \
  -H 'content-type: application/json' \
  --data '{
    "shopName": "tandanbo-CA",
    "sid": 11501,
    "shipperName": "Xiamen tandanbo wangluokeji youxiangongsi",
    "addressLine1": "Room 623-40, No. 89, Anling 2nd Road",
    "addressLine2": "",
    "city": "Xiamen",
    "companyName": "Xiamen tandanbo wangluokeji youxiangongsi",
    "countryCode": "CN",
    "email": "",
    "phoneNumber": "8615759601196",
    "planName": "探嘉BI-STA目标仓测试-CAMD-LEGBLUE-GM",
    "positionType": "2",
    "postalCode": "361006",
    "remark": "探嘉BI目标仓测试，仅查询实际仓库代码",
    "stateOrProvinceCode": "Fujian",
    "targetWarehouseCode": "",
    "cancelAfterPreview": true,
    "inboundPlanItems": [
      {
        "labelOwner": "SELLER",
        "msku": "CAMD-LEGBLUE-GM",
        "prepOwner": "SELLER",
        "quantity": 180
      }
    ]
  }'
```

## 返回里重点看这里

```json
{
  "warehouses": [
    {
      "wareHouseId": "目标仓库代码",
      "shipmentId": "货件id",
      "quantity": 180
    }
  ],
  "notice": "钉钉通知文本"
}
```

## 钉钉配置

服务器 `.env` 中增加：

```text
FBA_DINGTALK_WEBHOOK=
FBA_DINGTALK_SECRET=
```

真实 webhook 不要写进代码。
