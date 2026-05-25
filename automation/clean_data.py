#!/usr/bin/env python3
import argparse
import json
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd


def main():
    parser = argparse.ArgumentParser(description="清洗订单列表和销转表，生成保险平台投保数据")
    parser.add_argument("--orders", required=True, help="订单列表 xlsx 路径")
    parser.add_argument("--routes", required=True, help="销转表 xlsx 路径")
    parser.add_argument("--config", required=True, help="配置 JSON 路径")
    parser.add_argument("--output-dir", default="automation/outputs", help="输出目录")
    args = parser.parse_args()

    config = json.loads(Path(args.config).read_text(encoding="utf-8"))
    order_df = pd.read_excel(args.orders, dtype=str).fillna("")
    route_df = read_route_export(args.routes)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    enabled_tasks = [task for task in config["tasks"] if task.get("enabled")]
    results = []

    for task in enabled_tasks:
        route_config = find_route_config(config["routes"], task["routeName"])
        if not route_config:
            raise ValueError(f"未匹配总路线配置：{task['routeName']}")

        task_orders = filter_orders(order_df, task)
        if task_orders.empty:
            results.append({"task": task, "status": "empty", "message": "没有有效已付款旅客"})
            continue

        route_info = match_route_info(route_df, task_orders, task)
        insurance_payload = build_insurance_payload(task, route_config, route_info, task_orders)

        safe_name = safe_filename(f"{task['routeName']}_{task['startDate']}")
        json_path = output_dir / f"{safe_name}.json"
        txt_path = output_dir / f"{safe_name}_粘贴名单.txt"

        json_path.write_text(json.dumps(insurance_payload, ensure_ascii=False, indent=2), encoding="utf-8")
        txt_path.write_text(insurance_payload["pasteList"], encoding="utf-8")

        results.append(
            {
                "task": task,
                "status": "ok",
                "travelerCount": len(insurance_payload["travelers"]),
                "json": str(json_path),
                "pasteList": str(txt_path),
            }
        )

    summary_path = output_dir / "summary.json"
    summary_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"summary": str(summary_path), "results": results}, ensure_ascii=False, indent=2))


def read_route_export(path):
    raw = pd.read_excel(path, header=None, dtype=str).fillna("")
    if len(raw) < 2:
        raise ValueError("销转表格式异常：少于两行表头")

    headers = raw.iloc[1].tolist()
    data = raw.iloc[2:].copy()
    data.columns = headers
    return data.fillna("")


def filter_orders(order_df, task):
    route_name = normalize(task["routeName"])
    package_name = normalize(task.get("packageName", ""))
    start_date = normalize(task["startDate"])

    df = order_df.copy()
    df = df[df["订单状态"].eq("已付款")]
    df = df[df["参团状态"].eq("有效")]
    df = df[df["旅客姓名"].str.strip().ne("")]
    df = df[df["旅客证件号码"].str.strip().ne("")]
    df = df[df["路线"].map(normalize).eq(route_name)]
    df = df[df["出行时间"].map(normalize).str.startswith(start_date)]

    if package_name:
      df = df[df["套餐"].map(normalize).eq(package_name)]

    return df.drop_duplicates(subset=["旅客证件号码"], keep="first")


def match_route_info(route_df, task_orders, task):
    package_ids = set(task_orders["套餐编号"].dropna().astype(str))
    route_match = route_df[route_df["套餐编号"].astype(str).isin(package_ids)]

    if route_match.empty:
        route_name = normalize(task["routeName"])
        start_date = normalize(task["startDate"]).replace("-", "/")
        route_match = route_df[
            route_df["路线名称"].map(normalize).str.contains(route_name, regex=False)
            & route_df["开始时间"].map(normalize).str.startswith(start_date)
        ]

    if route_match.empty:
        return {}

    return route_match.iloc[0].to_dict()


def build_insurance_payload(task, route_config, route_info, orders):
    start_date = parse_date(task["startDate"])
    end_date = parse_date(task.get("endDate") or task["startDate"])
    offset_days = int(route_config.get("startOffsetDays") or 0)
    duration_days = int(route_config.get("durationDays") or max((end_date - start_date).days + 1, 1))
    insurance_start = start_date + timedelta(days=offset_days)
    insurance_end = insurance_start + timedelta(days=duration_days - 1)
    remark = render_template(route_config.get("remarkTemplate") or "{routeName} {startDate}", task, route_info)

    travelers = []
    paste_lines = []
    for _, row in orders.iterrows():
        traveler = {
            "name": row["旅客姓名"].strip(),
            "gender": row["旅客性别"].strip(),
            "idType": row["旅客证件类型"].strip() or "身份证",
            "idNumber": row["旅客证件号码"].strip(),
            "birthday": row["旅客出生日期"].strip(),
        }
        travelers.append(traveler)
        paste_lines.append(
            " ".join(
                value
                for value in [traveler["name"], traveler["gender"], traveler["idNumber"], traveler["birthday"]]
                if value
            )
        )

    return {
        "task": task,
        "insurance": {
            "category": route_config.get("category", ""),
            "insurer": route_config.get("insurer", ""),
            "product": route_config.get("product", ""),
            "plan": route_config.get("plan", ""),
            "startDate": insurance_start.strftime("%Y-%m-%d"),
            "startTime": route_config.get("startTime", "00:00:00"),
            "endDate": insurance_end.strftime("%Y-%m-%d"),
            "endTime": route_config.get("endTime", "23:59:59"),
            "durationDays": duration_days,
            "remark": remark,
            "companyCode": route_config.get("companyCode", ""),
        },
        "routeInfo": route_info,
        "travelers": travelers,
        "pasteList": "\n".join(paste_lines),
    }


def find_route_config(routes, route_name):
    target = normalize(route_name)
    for route in routes:
        if not route.get("enabled"):
            continue
        if normalize(route.get("routeName")) == target:
            return route
        keywords = [normalize(item) for item in str(route.get("keywords", "")).replace("，", ",").split(",") if item]
        if keywords and all(keyword in target for keyword in keywords):
            return route
    return None


def render_template(template, task, route_info):
    values = {
        "routeName": task.get("routeName", ""),
        "packageName": task.get("packageName", ""),
        "startDate": task.get("startDate", ""),
        "endDate": task.get("endDate", ""),
        "routeFullName": route_info.get("路线名称", task.get("routeName", "")),
        "leader": route_info.get("队长安排", ""),
    }
    for key, value in values.items():
        template = template.replace("{" + key + "}", str(value))
    return template


def parse_date(value):
    return datetime.strptime(str(value)[:10].replace("/", "-"), "%Y-%m-%d")


def normalize(value):
    return str(value or "").strip().lower()


def safe_filename(value):
    return "".join(char if char.isalnum() or char in "-_" else "_" for char in value)


if __name__ == "__main__":
    main()
