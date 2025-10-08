import os
import sys

# 상위 디렉토리를 Python 경로에 추가
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from flask import Flask, render_template_string, jsonify, request
from components.event_summary_panel import event_summary_bp
from components.event_analytics_graphs import event_analytics_bp
from components.channel_stats_panel import channel_stats_bp
from components.channel_detail_modal import channel_detail_bp
import requests

app = Flask(__name__, static_folder='../static')

# 백엔드 URL - 환경변수에서 가져오기 (Vercel 설정에서 추가)
BACKEND_URL = os.environ.get('BACKEND_URL', 'http://127.0.0.1:8000')

# 컴포넌트 블루프린트 등록
app.register_blueprint(event_summary_bp, url_prefix='/api')
app.register_blueprint(event_analytics_bp, url_prefix='/api')
app.register_blueprint(channel_stats_bp, url_prefix='/api')
app.register_blueprint(channel_detail_bp, url_prefix='/api')


# 날짜 범위 API 라우트
@app.route('/api/date-range')
def get_date_range():
    """날짜 범위 조회 API 프록시"""
    try:
        response = requests.get(f"{BACKEND_URL}/api/v1/date-range", timeout=10)
        if response.ok:
            data = response.json()
            print(f"[DATE_RANGE] API 호출 성공: {data}")
            return jsonify(data)
        else:
            error_msg = f"Backend returned {response.status_code}"
            print(f"[DATE_RANGE] API 오류: {error_msg}")
            return jsonify({"error": error_msg}), response.status_code
    except requests.RequestException as e:
        error_msg = f"Connection error: {str(e)}"
        print(f"[DATE_RANGE] 연결 오류: {error_msg}")
        return jsonify({"error": error_msg}), 500


@app.route('/')
def dashboard():
    """통합 대시보드 메인 페이지"""
    return render_template_string(HTML_TEMPLATE)


# 헬스체크 엔드포인트
@app.route('/health')
def health_check():
    """헬스체크 엔드포인트"""
    return jsonify({"status": "healthy", "service": "VODA NVR Dashboard"})


# 채널 상세 정보 API 라우트 확인을 위한 디버그 라우트
@app.route('/api/debug/routes')
def debug_routes():
    """등록된 라우트 확인용"""
    routes = []
    for rule in app.url_map.iter_rules():
        routes.append({
            'endpoint': rule.endpoint,
            'methods': list(rule.methods),
            'rule': str(rule)
        })
    return {'routes': routes}


# HTML 템플릿
HTML_TEMPLATE = '''
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>VODA NVR Smart Dashboard</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/3.9.1/chart.min.js"></script>
    <link rel="stylesheet" href="/static/styles.css">
</head>
<body>
    <div class="main-container">
        <!-- 헤더 -->
        <div class="header">
            <h1><span class="voda-nvr">VODA NVR</span> <span class="smart-dashboard">Smart Dashboard</span></h1>
            <p id="reportTitle" style="display: none;">실시간 이벤트 모니터링 및 채널 관리 시스템</p>
        </div>

        <!-- 상태 표시 -->
        <div id="status" class="status"></div>

        <!-- Main Content - 3 Column Grid -->
        <div class="content-grid">
            <!-- Left Panel - Controls + Stats -->
            <div class="left-panel">
                <!-- Control Panel -->
                <div class="control-panel">
                    <div class="date-group">
                        <label>시작일:</label>
                        <input type="date" id="startDate" value="2025-07-26">
                    </div>
                    <div class="date-group">
                        <label>종료일:</label>
                        <input type="date" id="endDate" value="2025-09-24">
                    </div>
                    <button class="btn" onclick="loadAllData()">데이터 불러오기</button>
                    <button class="btn" onclick="startAutoRefresh()">자동 새로고침 시작</button>
                    <button class="btn" onclick="stopAutoRefresh()">자동 새로고침 중지</button>
                </div>

                <!-- Stats Panel -->
                <div class="stats-panel" id="statsContainer">
                    <div class="stat-card">
                        <div class="stat-number" id="totalEvents">0</div>
                        <div class="stat-label">총 이벤트</div>
                    </div>
                    <div class="stat-card critical-card">
                        <div class="stat-number critical-number" id="criticalEvents">0</div>
                        <div class="stat-label">🔴 위험</div>
                    </div>
                    <div class="stat-card warn-card">
                        <div class="stat-number warn-number" id="warnEvents">0</div>
                        <div class="stat-label">🟡 경고</div>
                    </div>
                    <div class="stat-card info-card">
                        <div class="stat-number info-number" id="infoEvents">0</div>
                        <div class="stat-label">🟢 정보</div>
                    </div>
                </div>
            </div>

            <!-- Middle Panel - Charts -->
            <div class="middle-panel">
                <div class="chart-panel">
                    <div class="chart-title">📊 이벤트 타입별 분석</div>
                    <div class="chart-container">
                        <canvas id="eventTypeChart"></canvas>
                    </div>
                </div>

                <div class="chart-panel">
                    <div class="chart-title">📊 시간대별 이벤트 분석</div>
                    <div class="chart-container">
                        <canvas id="hourlyChart"></canvas>
                    </div>
                </div>
            </div>

            <!-- Right Panel - Channels -->
            <div class="right-panel">
                <h3>📺 채널별 이벤트 통계</h3>
                <div class="channel-grid" id="channelGrid">
                    <div class="no-data">데이터를 불러오려면<br>'데이터 불러오기'<br>버튼을 클릭하세요</div>
                </div>
            </div>
        </div>

        <!-- 채널 상세 모달 -->
        <div id="channelModal" class="modal">
            <div class="modal-content">
                <span class="close" onclick="closeModal()" tabindex="0" role="button" aria-label="모달 닫기">&times;</span>
                <h2 class="modal-title" id="modalTitle"></h2>

                <div class="detail-section">
                    <h3 class="section-title">상세 정보</h3>
                    <div id="detailContent"></div>
                </div>

                <div class="location-section">
                    <h3 class="section-title">카메라 위치</h3>
                    <div class="location-display" id="locationDisplay">
                        <div class="location-info" id="locationInfo"></div>
                        <div class="location-display-container">
                            <div class="emap-section">
                                <div class="section-subtitle">E-MAP</div>
                                <div class="emap-container" id="emapContainer">
                                    <div class="placeholder">E-MAP 이미지 표시 영역</div>
                                </div>
                            </div>
                            <div class="fov-section">
                                <div class="section-subtitle">카메라 FOV</div>
                                <div class="fov-container" id="fovContainer">
                                    <div class="placeholder">FOV 썸네일 표시 영역</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- 툴팁 -->
    <div class="tooltip" id="tooltip" style="display: none;"></div>

    <script src="/static/dashboard.js"></script>
</body>
</html>
'''


# Vercel serverless function handler
def handler(request):
    with app.request_context(request.environ):
        return app.full_dispatch_request()


# 로컬 개발용
if __name__ == '__main__':
    app.run(debug=True, host='127.0.0.1', port=8006)