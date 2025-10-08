// 전역 변수
let autoRefreshInterval = null;
let eventTypeChart = null;
let hourlyChart = null;
let dateRange = { start: null, end: null }
let currentSeverityFilter = 'all'; 
let focusedElementBeforeModal;

// ========== 새로 추가된 오류 처리 함수들 ==========

// 백엔드 오류 응답을 한국어로 변환하는 함수
function translateBackendError(errorData, statusCode) {
    let userMessage = '';
    let errorType = '';
    let technicalDetails = {};
    
    // 전체 오류 정보 추출
    const errorInfo = {
        error: errorData.error,
        path: errorData.path,
        method: errorData.method,
        status: errorData.status || statusCode,
        detail: errorData.detail
    };
    
    if (statusCode === 400 && errorData.error === 'invalid_request') {
        // Pydantic 검증 오류 처리
        if (errorData.detail && Array.isArray(errorData.detail)) {
            const validationErrors = errorData.detail.map(err => {
                // 모든 필드 정보 추출
                const fieldInfo = {
                    type: err.type,
                    location: err.loc,
                    message: err.msg,
                    input: err.input,
                    context: err.ctx,
                    url: err.url
                };
                
                // 날짜 관련 검증 오류들을 한국어로 변환
                if (err.loc && err.loc.includes('end') && err.ctx && err.ctx.error === 'end must be >= start') {
                    return {
                        korean: '종료일은 시작일과 같거나 늦어야 합니다',
                        input: err.input,
                        field: 'end',
                        technical: fieldInfo
                    };
                } else if (err.loc && err.loc.includes('start')) {
                    return {
                        korean: '시작일 형식이 올바르지 않습니다 (YYYY-MM-DD 형식 필요)',
                        input: err.input,
                        field: 'start',
                        technical: fieldInfo
                    };
                } else if (err.loc && err.loc.includes('end') && !err.ctx?.error?.includes('>=')) {
                    return {
                        korean: '종료일 형식이 올바르지 않습니다 (YYYY-MM-DD 형식 필요)',
                        input: err.input,
                        field: 'end',
                        technical: fieldInfo
                    };
                } else if (err.loc && err.loc.includes('severity')) {
                    return {
                        korean: '심각도 값이 올바르지 않습니다 (all, critical, warn, info 중 선택)',
                        input: err.input,
                        field: 'severity',
                        technical: fieldInfo
                    };
                }
                
                return {
                    korean: err.msg || '입력값 오류',
                    input: err.input,
                    field: err.loc ? err.loc.join('.') : 'unknown',
                    technical: fieldInfo
                };
            });
            
            userMessage = '입력 데이터 오류:\n' + validationErrors.map(e => `• ${e.korean}`).join('\n');
            if (validationErrors.length > 0 && validationErrors[0].input) {
                userMessage += `\n\n입력된 값: ${validationErrors[0].input}`;
            }
            
            errorType = 'validation';
            technicalDetails = {
                apiPath: errorData.path,
                method: errorData.method,
                validationErrors: validationErrors.map(e => e.technical)
            };
        } else {
            userMessage = '잘못된 요청입니다. 입력값을 확인해주세요.';
            errorType = 'bad_request';
        }
    } else if (statusCode === 400) {
        userMessage = '필수 매개변수가 누락되었습니다.\n시작일과 종료일을 YYYY-MM-DD 형식으로 입력해주세요.';
        errorType = 'missing_params';
    } else if (statusCode === 413) {
        userMessage = '요청 데이터가 너무 큽니다.\n날짜 범위를 줄여서 다시 시도해주세요.';
        errorType = 'payload_too_large';
    } else if (statusCode === 500) {
        userMessage = '서버 내부 오류가 발생했습니다.\n잠시 후 다시 시도해주세요.';
        errorType = 'server_error';
    } else {
        userMessage = `서버 오류가 발생했습니다 (코드: ${statusCode})\n관리자에게 문의해주세요.`;
        errorType = 'unknown_error';
    }
    
    return {
        userMessage,
        errorType,
        statusCode,
        apiInfo: {
            path: errorData.path,
            method: errorData.method,
            status: errorData.status
        },
        technicalDetails,
        originalError: errorData
    };
}

// 개선된 API 호출 함수
async function makeApiCall(url, apiName = 'API') {
    try {
        console.log(`[${apiName}] 호출 시작: ${url}`);
        
        const response = await fetch(url);
        const responseData = await response.json();
        
        if (response.ok) {
            console.log(`[${apiName}] 성공:`, responseData);
            return { success: true, data: responseData };
        } else {
            console.error(`[${apiName}] 오류 응답:`, responseData);
            const errorInfo = translateBackendError(responseData, response.status);
            
            return { 
                success: false, 
                error: errorInfo,
                rawError: responseData
            };
        }
    } catch (networkError) {
        console.error(`[${apiName}] 네트워크 오류:`, networkError);
        
        return {
            success: false,
            error: {
                userMessage: '네트워크 연결에 실패했습니다.\n인터넷 연결을 확인하고 다시 시도해주세요.',
                errorType: 'network_error',
                statusCode: 0,
                apiInfo: { path: url, method: 'GET', status: 0 },
                originalError: networkError.message
            }
        };
    }
}

// 날짜 유효성 검사
function validateDatesBeforeSubmit(startDate, endDate) {
    const errors = [];
    
    if (!startDate) {
        errors.push('시작일을 선택해주세요');
    }
    if (!endDate) {
        errors.push('종료일을 선택해주세요');
    }
    
    if (errors.length > 0) {
        return {
            isValid: false,
            errors: errors,
            userMessage: errors.join('\n')
        };
    }
    
    const startDateObj = new Date(startDate);
    const endDateObj = new Date(endDate);
    
    if (isNaN(startDateObj.getTime())) {
        errors.push('시작일 형식이 올바르지 않습니다');
    }
    if (isNaN(endDateObj.getTime())) {
        errors.push('종료일 형식이 올바르지 않습니다');
    }
    
    if (errors.length > 0) {
        return {
            isValid: false,
            errors: errors,
            userMessage: errors.join('\n')
        };
    }
    
    if (endDateObj < startDateObj) {
        return {
            isValid: false,
            errors: ['종료일은 시작일보다 늦어야 합니다'],
            userMessage: '종료일은 시작일보다 늦어야 합니다.\n날짜를 다시 확인해주세요.'
        };
    }
    
    if (window.dateRange) {
        if (startDate < window.dateRange.start || endDate > window.dateRange.end) {
            return {
                isValid: false,
                errors: ['허용된 날짜 범위를 벗어났습니다'],
                userMessage: `허용된 날짜 범위: ${window.dateRange.start} ~ ${window.dateRange.end}\n범위 내의 날짜를 선택해주세요.`
            };
        }
    }
    
    return { isValid: true };
}

// 향상된 오류 표시 함수
function showErrorWithDetails(error, duration = 7000) {
    const statusElement = document.getElementById('status');
    
    let icon = '';
    switch (error.errorType) {
        case 'validation':
            icon = '⚠️ ';
            statusElement.className = 'status error validation';
            break;
        case 'network_error':
            icon = '🌐 ';
            statusElement.className = 'status error network';
            break;
        case 'server_error':
            icon = '🔧 ';
            statusElement.className = 'status error server';
            break;
        default:
            icon = '❌ ';
            statusElement.className = 'status error';
    }
    
    let apiInfo = '';
    if (error.apiInfo) {
        apiInfo = `\n📍 API: ${error.apiInfo.method} ${error.apiInfo.path}`;
    }
    
    // 기술적 상세 정보를 콘솔에 출력
    if (error.technicalDetails || error.originalError) {
        console.group(`🚨 상세 오류 정보 - ${error.errorType}`);
        console.log('사용자 메시지:', error.userMessage);
        if (error.apiInfo) {
            console.log('API 정보:', error.apiInfo);
        }
        if (error.technicalDetails) {
            console.log('기술적 상세:', error.technicalDetails);
        }
        if (error.originalError) {
            console.log('원본 오류 응답:', error.originalError);
        }
        console.groupEnd();
    }
    
    statusElement.innerHTML = `
        <div class="error-header">${icon}오류 발생</div>
        <div class="error-message">${error.userMessage}${apiInfo}</div>
        <div class="error-code">상태 코드: ${error.statusCode || 'UNKNOWN'}</div>
    `;
    
    statusElement.style.display = 'block';
    
    if (duration > 0) {
        setTimeout(() => {
            hideStatus();
        }, duration);
    }
}

// ========== 기존 핵심 기능들 (수정됨) ==========

// 전체 데이터 로드 - 오류 처리 개선
async function loadAllData(severityOverride = null) {
    const startDate = document.getElementById('startDate')?.value;
    const endDate = document.getElementById('endDate')?.value;
    const severity = severityOverride || currentSeverityFilter;
    const channel_id = document.getElementById('channelSelect')?.value || 'all';

    // 프론트엔드에서 사전 검증
    const validation = validateDatesBeforeSubmit(startDate, endDate);
    if (!validation.isValid) {
        showErrorWithDetails({
            userMessage: validation.userMessage,
            errorType: 'validation',
            statusCode: 'CLIENT',
            apiInfo: { path: 'client-validation', method: 'CLIENT', status: 'CLIENT' }
        });
        return;
    }
    
    // 날짜 범위 유효성 한 번 더 검증
    if (dateRange) {
        if (startDate < dateRange.start || startDate > dateRange.end || 
            endDate < dateRange.start || endDate > dateRange.end) {
            showErrorWithDetails({
                userMessage: `선택한 날짜가 허용 범위(${dateRange.start} ~ ${dateRange.end})를 벗어났습니다. 날짜를 확인해주세요.`,
                errorType: 'validation',
                statusCode: 'CLIENT'
            });
            return;
        }
    }
    
    // 동적 리포트 제목 업데이트
    updateReportTitle(startDate, endDate, severity);

    showStatus('데이터를 불러오는 중...', 'loading');

    try {
        const params = new URLSearchParams({
            start: startDate,
            end: endDate,
            severity: severity,
            channel_id: channel_id
        });

        // API 호출들
        const apiCalls = [
            { 
                name: '이벤트 요약', 
                url: `/api/proxy/events/summary?${params}`,
                handler: (data) => updateEventSummary(data.counts, severity)
            },
            { 
                name: '이벤트 분석', 
                url: `/api/proxy/events/analytics?${params}`,
                handler: (data) => {
                    createEventTypeChart(data.type_pie, severity);
                    createHourlyChart(data.hourly_bar, severity);
                }
            },
            { 
                name: '채널 정보', 
                url: `/api/proxy/channels?${params}`,
                handler: (data) => {
                    const channelData = channel_id === 'all' ? data : { items: [data] };
                    displayChannelData(channelData, severity);
                }
            }
        ];

        let successCount = 0;
        let errorMessages = [];

        for (const apiCall of apiCalls) {
            const result = await makeApiCall(apiCall.url, apiCall.name);
            
            if (result.success) {
                try {
                    apiCall.handler(result.data);
                    successCount++;
                } catch (handlerError) {
                    console.error(`${apiCall.name} 데이터 처리 오류:`, handlerError);
                    errorMessages.push(`${apiCall.name} 데이터 처리 실패`);
                }
            } else {
                errorMessages.push(`${apiCall.name}: ${result.error.userMessage}`);
                
                // 첫 번째 API 오류는 자세히 표시
                if (errorMessages.length === 1) {
                    showErrorWithDetails(result.error, 8000);
                }
            }
        }

        // 결과 요약 표시
        if (successCount === apiCalls.length) {
            const severityLabel = getSeverityLabel(severity);
            showStatus(`${severityLabel} 데이터를 성공적으로 불러왔습니다!`, 'success');
            setTimeout(hideStatus, 3000);
        } else if (successCount > 0) {
            showStatus(`일부 데이터만 로드되었습니다.\n성공: ${successCount}/${apiCalls.length}`, 'warning');
            setTimeout(hideStatus, 5000);
        } else {
            showErrorWithDetails({
                userMessage: `모든 데이터 로드에 실패했습니다:\n${errorMessages.join('\n')}`,
                errorType: 'multiple_errors',
                statusCode: 'MULTIPLE',
                apiInfo: { path: 'multiple-apis', method: 'GET', status: 'MULTIPLE' }
            }, 10000);
        }

    } catch (unexpectedError) {
        console.error('예상치 못한 오류:', unexpectedError);
        showErrorWithDetails({
            userMessage: `예상치 못한 오류가 발생했습니다:\n${unexpectedError.message}\n\n페이지를 새로고침해주세요.`,
            errorType: 'unexpected',
            statusCode: 'JS_ERROR',
            apiInfo: { path: 'javascript', method: 'CLIENT', status: 'JS_ERROR' },
            originalError: unexpectedError
        }, 10000);
    }
}

// severity 필터 설정 및 UI 업데이트
function setCurrentSeverityFilter(severity) {
    currentSeverityFilter = severity;
    
    // 모든 카드에서 active 클래스 제거
    document.querySelectorAll('.stat-card').forEach(card => {
        card.classList.remove('active-filter');
    });

    // 선택된 카드에 active 클래스 추가
    let targetCard;
    switch(severity) {
        case 'all':
            targetCard = document.getElementById('totalEvents')?.parentElement;
            break;
        case 'critical':
            targetCard = document.getElementById('criticalEvents')?.parentElement;
            break;
        case 'warn':
            targetCard = document.getElementById('warnEvents')?.parentElement;
            break;
        case 'info':
            targetCard = document.getElementById('infoEvents')?.parentElement;
            break;
    }

    if (targetCard) {
        targetCard.classList.add('active-filter');
    }
}

// severity 라벨 반환
function getSeverityLabel(severity) {
    switch(severity) {
        case 'critical': return '🔴 위험';
        case 'warn': return '🟡 경고';
        case 'info': return '🟢 정보';
        case 'all': 
        default: return '전체';
    }
}

// 동적 리포트 제목 업데이트
function updateReportTitle(startDate, endDate, severity = 'all') {
    const reportTitleElement = document.getElementById('reportTitle');
    if (startDate && endDate) {
        const formatDate = (dateStr) => {
            const date = new Date(dateStr);
            const month = date.getMonth() + 1;
            const day = date.getDate();
            return `${month}월 ${day}일`;
        };
        
        const startFormatted = formatDate(startDate);
        const endFormatted = formatDate(endDate);
        const severityLabel = getSeverityLabel(severity);
        
        let titleText = `${startFormatted} ~ ${endFormatted} 분석 리포트`;
        if (severity !== 'all') {
            titleText += ` - ${severityLabel} 이벤트만`;
        }
        
        reportTitleElement.textContent = titleText;
        reportTitleElement.style.display = 'block';
    } else {
        reportTitleElement.textContent = '실시간 이벤트 모니터링 및 채널 관리 시스템';
        reportTitleElement.style.display = 'block';
    }
}

// 통계 카드 클릭 이벤트 설정
function setupStatCardClicks() {
    const totalCard = document.getElementById('totalEvents')?.parentElement;
    if (totalCard) {
        totalCard.addEventListener('click', () => handleSeverityCardClick('all'));
    }

    const criticalCard = document.getElementById('criticalEvents')?.parentElement;
    if (criticalCard) {
        criticalCard.addEventListener('click', () => handleSeverityCardClick('critical'));
    }

    const warnCard = document.getElementById('warnEvents')?.parentElement;
    if (warnCard) {
        warnCard.addEventListener('click', () => handleSeverityCardClick('warn'));
    }

    const infoCard = document.getElementById('infoEvents')?.parentElement;
    if (infoCard) {
        infoCard.addEventListener('click', () => handleSeverityCardClick('info'));
    }
}

// severity 카드 클릭 처리
async function handleSeverityCardClick(severity) {
    try {
        setCurrentSeverityFilter(severity);
        await loadAllData(severity);
    } catch (error) {
        console.error('Severity 필터링 오류:', error);
        showErrorWithDetails({
            userMessage: '필터링 중 오류가 발생했습니다.',
            errorType: 'client_error',
            statusCode: 'CLIENT'
        });
    }
}

// 자동 새로고침
function startAutoRefresh() {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    autoRefreshInterval = setInterval(() => loadAllData(), 30000);
    showStatus('자동 새로고침이 시작되었습니다 (30초마다)', 'success');
    setTimeout(hideStatus, 2000);
}

function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
        showStatus('자동 새로고침이 중지되었습니다', 'success');
        setTimeout(hideStatus, 2000);
    }
}

// ========== 초기화 ==========
window.addEventListener('DOMContentLoaded', async () => {
    // 먼저 날짜 범위를 가져옴
    await fetchDateRange();
    // 통계 카드 클릭 이벤트 설정
    setupStatCardClicks();
    // 초기 날짜값으로 리포트 제목 설정
    const startDate = document.getElementById('startDate')?.value;
    const endDate = document.getElementById('endDate')?.value;
    
    if (startDate && endDate) {
        updateReportTitle(startDate, endDate, 'all');
    } else {
        const reportTitleElement = document.getElementById('reportTitle');
        reportTitleElement.textContent = '실시간 이벤트 모니터링 및 채널 관리 시스템';
        reportTitleElement.style.display = 'block';
    }
    // UI 개선 기능들 초기화
    enableImageZoom();
    enableKeyboardNavigation();
    
    // 동적으로 생성되는 채널 카드 감시
    const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.type === 'childList') {
                updateChannelCardAccessibility();
            }
        });
    });

    observer.observe(document.getElementById('channelGrid'), {
        childList: true,
        subtree: true
    });
    
    // 날짜 검증 설정
    setupDateValidation();
    
    // 데이터 로드
    loadAllData();
});

// 이벤트 요약 업데이트
function updateEventSummary(data, severity = 'all') {
    document.getElementById('statsContainer').style.display = 'grid';
    
    if (severity === 'all') {
        animateCounter('totalEvents', data.total);
        animateCounter('criticalEvents', data.critical);
        animateCounter('warnEvents', data.warn);
        animateCounter('infoEvents', data.info);
    } else {
        const selectedValue = data[severity] || 0;
        animateCounter('totalEvents', selectedValue);
        animateCounter('criticalEvents', data.critical);
        animateCounter('warnEvents', data.warn);
        animateCounter('infoEvents', data.info);
    }
}

// 이벤트 타입 차트 생성
function createEventTypeChart(typeData, severity = 'all') {
    const ctx = document.getElementById('eventTypeChart').getContext('2d');

    if (eventTypeChart) {
        eventTypeChart.destroy();
    }

    if (!typeData || typeData.length === 0) {
        const container = document.querySelector('#eventTypeChart').parentElement.parentElement;
        const severityLabel = getSeverityLabel(severity);
        container.innerHTML = `
            <div class="chart-title">📊 이벤트 타입별 분석 - ${severityLabel}</div>
            <div class="no-data">${severityLabel} 이벤트 타입 데이터가 없습니다.</div>
        `;
        return;
    }

    const labels = typeData.map(item => item.label);
    const data = typeData.map(item => item.count);
    const colors = getSeverityColors(severity);

    // 차트 제목 업데이트
    const titleElement = document.querySelector('#eventTypeChart').parentElement.parentElement.querySelector('.chart-title');
    if (titleElement) {
        const severityLabel = getSeverityLabel(severity);
        titleElement.textContent = `📊 이벤트 타입별 분석 - ${severityLabel}`;
    }

    eventTypeChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors.slice(0, data.length),
                borderWidth: 2,
                borderColor: 'rgba(255, 255, 255, 0.8)'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 20,
                        usePointStyle: true,
                        color: '#1C1C1B',
                        font: { size: 12 }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    callbacks: {
                        label: function(context) {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = ((context.parsed * 100) / total).toFixed(1);
                            return `${context.label}: ${context.parsed}건 (${percentage}%)`;
                        }
                    }
                }
            },
            animation: {
                duration: 2000,
                easing: 'easeInOutQuart'
            }
        }
    });
}

// 시간대별 차트 생성
function createHourlyChart(hourlyData, severity = 'all') {
    const ctx = document.getElementById('hourlyChart').getContext('2d');

    if (hourlyChart) {
        hourlyChart.destroy();
    }

    if (!hourlyData || hourlyData.length === 0) {
        const container = document.querySelector('#hourlyChart').parentElement.parentElement;
        const severityLabel = getSeverityLabel(severity);
        container.innerHTML = `
            <div class="chart-title">📊 시간대별 이벤트 분석 - ${severityLabel}</div>
            <div class="no-data">${severityLabel} 시간대별 데이터가 없습니다.</div>
        `;
        return;
    }

    const hours = Array.from({length: 24}, (_, i) => i);
    const counts = hours.map(hour => {
        const hourData = hourlyData.find(item => item.hour === hour);
        return hourData ? hourData.count : 0;
    });

    // 차트 제목 업데이트
    const titleElement = document.querySelector('#hourlyChart').parentElement.parentElement.querySelector('.chart-title');
    if (titleElement) {
        const severityLabel = getSeverityLabel(severity);
        titleElement.textContent = `📊 시간대별 이벤트 분석 - ${severityLabel}`;
    }

    hourlyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: hours.map(h => `${h}시`),
            datasets: [{
                label: '이벤트 수',
                data: counts,
                backgroundColor: getSeverityColor(severity,0.7),
                borderColor:getSeverityColor(severity,1),
                borderWidth: 2,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { stepSize: 1, color: '#1C1C1B' },
                    grid: { color: 'rgba(255, 255, 255, 0.2)' }
                },
                x: {
                    ticks: { color: '#1C1C1B' },
                    grid: { display: false }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    callbacks: {
                        label: function(context) {
                            const severityLabel = getSeverityLabel(severity);
                            return `${severityLabel} 이벤트: ${context.parsed.y}건`;
                        }
                    }
                }
            },
            animation: {
                duration: 2000,
                easing: 'easeInOutQuart'
            }
        }
    });
}

// severity별 색상 반환
function getSeverityColor(severity, alpha = 1) {
    switch(severity) {
        case 'critical':
            return `rgba(221, 46, 68, ${alpha})`;
        case 'warn':
            return `rgba(244, 144, 12, ${alpha})`;
        case 'info':
            return `rgba(119, 178, 86, ${alpha})`;
        default:
            return `rgba(169, 143, 123, ${alpha})`;
    }
}

// severity별 색상 배열 반환
function getSeverityColors(severity) {
    switch(severity) {
        case 'critical':
            return ['#DD2E44', '#E74C3C', '#C0392B', '#A93226', '#922B21'];
        case 'warn':
            return ['#F4900C', '#E67E22', '#D68910', '#B7950B', '#9A7D0A'];
        case 'info':
            return ['#77B256', '#58D68D', '#52C41A', '#389E0D', '#237804'];
        default:
            return ['#FF6384', '#6EC6FF', '#FFCE56', '#4BC0C0', '#9966FF'];
    }
}

// 채널 데이터 표시
function displayChannelData(data, severity = 'all') {
    const grid = document.getElementById('channelGrid');

    if (!data.items || data.items.length === 0) {
        const severityLabel = getSeverityLabel(severity);
        grid.innerHTML = `<div class="no-data">선택된 기간에 ${severityLabel} 이벤트 데이터가 없습니다.</div>`;
        return;
    }

    // 채널 번호순으로 정렬
    const sortedChannels = data.items.sort((a, b) => {
        const channelA = parseInt(a.channel_id);
        const channelB = parseInt(b.channel_id);
        return channelA - channelB;
    });

    // 차트 제목 업데이트
    const titleElement = grid.parentElement.querySelector('.chart-title');
    if (titleElement) {
        const severityLabel = getSeverityLabel(severity);
        titleElement.textContent = `📺 채널별 이벤트 통계 - ${severityLabel} (클릭하여 상세 정보 보기)`;
    }

    let html = '';
    sortedChannels.forEach(channel => {
        const channelNum = channel.channel_id.padStart(2, '0');
        const statusClass = channel.status === 'ON' ? 'status-on' : 'status-off';

        html += `
            <div class="channel-card" 
                    data-channel-id="${channel.channel_id}"
                    onmouseenter="showTooltip(event, this)" 
                    onmouseleave="hideTooltip()" 
                    onmousemove="moveTooltip(event)"
                    onclick="openChannelModal('${channel.channel_id}')">
                <div class="channel-number">CH${channelNum}</div>
                <div class="channel-events">${channel.count}건</div>
                <div class="channel-status ${statusClass}">${channel.status}</div>
            </div>
        `;
    });

    grid.innerHTML = html;

    // 채널 카드에 툴팁 데이터 추가
    sortedChannels.forEach(channel => {
        const card = document.querySelector(`[data-channel-id="${channel.channel_id}"]`);
        if (card) {
            card.setAttribute('data-channel', JSON.stringify(channel));
        }
    });
    // 접근성 개선 적용
    setTimeout(() => {
        updateChannelCardAccessibility();
    }, 100);
}

// 채널 모달창 열기 - 개선된 오류 처리
async function openChannelModal(channelId) {
    focusedElementBeforeModal = document.activeElement;

    const modal = document.getElementById('channelModal');
    const title = document.getElementById('modalTitle');
    const detailContent = document.getElementById('detailContent');
    const locationInfo = document.getElementById('locationInfo');
    const emapContainer = document.getElementById('emapContainer');
    const fovContainer = document.getElementById('fovContainer');
    const archiveContent = document.getElementById('archiveContent');

    // 로딩 표시
    const chStr = `CH${channelId.toString().padStart(2, '0')}`;
    const severityLabel = getSeverityLabel(currentSeverityFilter);
    title.textContent = `${chStr} 채널 상세 정보 - ${severityLabel} (로딩 중...)`;
    
    modal.style.display = "block";
    
    // 포커스 이동
    setTimeout(() => {
        if (modal.style.display === 'block') {
            const closeButton = modal.querySelector('.close');
            if (closeButton) closeButton.focus();
        }
    }, 100);

    const sections = {
        detailContent: '상세 정보를 불러오는 중...',
        locationInfo: '위치 정보를 불러오는 중...',
        emapContainer: 'E-MAP 로딩 중...',
        fovContainer: 'FOV 로딩 중...',
        archiveContent: '아카이브 데이터를 불러오는 중...'
    };
    
    Object.entries(sections).forEach(([id, message]) => {
        document.getElementById(id).innerHTML = `<div class="loading-spinner">${message}</div>`;
    });

    try {
        const startDate = document.getElementById('startDate')?.value;
        const endDate = document.getElementById('endDate')?.value;

        const validation = validateDatesBeforeSubmit(startDate, endDate);
        if (!validation.isValid) {
            throw new Error('날짜 설정이 올바르지 않습니다.');
        }

        const params = new URLSearchParams({
            start: startDate,
            end: endDate,
            severity: currentSeverityFilter
        });

        const result = await makeApiCall(`/api/proxy/channels/${channelId}?${params}`, `채널-${channelId}`);
        
        if (!result.success) {
            throw new Error(result.error.userMessage);
        }

        const channelData = result.data;
        
        // 모달 제목 업데이트
        title.textContent = `${chStr} 채널 상세 정보 - ${severityLabel}`;

        // 상세 정보 섹션 업데이트
        updateModalDetailSection(channelData, chStr, severityLabel);
        
        // 위치 정보 섹션 업데이트
        updateModalLocationSection(channelData, chStr);
        
        // 이미지 섹션 업데이트
        updateModalImageSections(channelData, chStr);
        
        // 아카이브 섹션 업데이트
        updateModalArchiveSection(channelData, chStr, severityLabel);

        console.log(`[MODAL] 채널 ${channelId} 상세 정보 로드 완료 (${severityLabel}):`, channelData);

    } catch (error) {
        console.error(`채널 ${channelId} 상세 정보 로드 실패:`, error);
        
        // 오류 표시
        title.textContent = `${chStr} 채널 상세 정보 (오류 발생)`;
        detailContent.innerHTML = `<div class="error-message">데이터를 불러오지 못했습니다: ${error.message}</div>`;
        locationInfo.innerHTML = '<div class="error-message">위치 정보를 불러오지 못했습니다.</div>';
        emapContainer.innerHTML = '<div class="placeholder error">E-MAP을 불러올 수 없습니다</div>';
        fovContainer.innerHTML = '<div class="placeholder error">FOV를 불러올 수 없습니다</div>';
        archiveContent.innerHTML = '<div class="error-message">아카이브 데이터를 불러오지 못했습니다.</div>';
    }
}

// 모달창 닫기
function closeModal() {
    const modal = document.getElementById('channelModal');
    modal.style.display = "none";
    // 원래 포커스된 요소로 돌아가기
    if (focusedElementBeforeModal) {
        focusedElementBeforeModal.focus();
        focusedElementBeforeModal = null;
    }

    // 모달 외부 클릭시 닫기
    window.onclick = function(event) {
        const modal = document.getElementById('channelModal');
        if (event.target == modal) {
            closeModal();
        }
    }
}

// 날짜 입력 실시간 검증
function setupDateValidation() {
    const startInput = document.getElementById('startDate');
    const endInput = document.getElementById('endDate');
    
    if (!startInput || !endInput) return;
    
    function validateAndShowFeedback() {
        const startDate = startInput.value;
        const endDate = endInput.value;
        
        if (startDate && endDate) {
            const validation = validateDatesBeforeSubmit(startDate, endDate);
            
            if (!validation.isValid) {
                // 입력 필드에 시각적 피드백
                if (validation.errors.some(e => e.includes('종료일은 시작일보다'))) {
                    endInput.classList.add('date-error');
                    startInput.classList.remove('date-error');
                } else {
                    startInput.classList.add('date-error');
                    endInput.classList.add('date-error');
                }
                
                console.warn('날짜 검증 오류:', validation.errors);
            } else {
                startInput.classList.remove('date-error');
                endInput.classList.remove('date-error');
            }
        }
    }
    
    startInput.addEventListener('change', validateAndShowFeedback);
    endInput.addEventListener('change', validateAndShowFeedback);
}

// 날짜 유효성 검사 및 시각적 피드백
function validateAndStyleDateInput(input) {
    const inputValue = input.value;
    
    if (!dateRange || !inputValue) {
        input.classList.remove('valid-date', 'invalid-shake', 'out-of-range');
        return true;
    }
    
    const isValid = inputValue >= dateRange.start && inputValue <= dateRange.end;
    
    if (isValid) {
        input.classList.remove('invalid-shake', 'out-of-range');
        input.classList.add('valid-date');
        return true;
    } else {
        input.classList.remove('valid-date');
        input.classList.add('invalid-shake', 'out-of-range');
        
        setTimeout(() => {
            input.classList.remove('invalid-shake');
        }, 500);
        
        return false;
    }
}

// 개선된 날짜 범위 유효성 검사 함수
function validateDateRange(event) {
    const input = event.target;
    const inputValue = input.value;
    
    if (!dateRange || !inputValue) return;
    
    let adjustedValue = inputValue;
    let messageShown = false;
    
    // 범위를 벗어나는 경우 자동 조정
    if (inputValue < dateRange.start) {
        adjustedValue = dateRange.start;
        showStatus(`입력 가능한 최소 날짜는 ${dateRange.start}입니다. 자동으로 조정했습니다.`, 'error');
        messageShown = true;
    } else if (inputValue > dateRange.end) {
        adjustedValue = dateRange.end;
        showStatus(`입력 가능한 최대 날짜는 ${dateRange.end}입니다. 자동으로 조정했습니다.`, 'error');
        messageShown = true;
    }
    
    // 값이 조정되었다면 입력 필드 업데이트
    if (adjustedValue !== inputValue) {
        input.value = adjustedValue;
    }
    
    // 시작일과 종료일 간의 논리적 검증
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    
    if (startDate && endDate && startDate > endDate) {
        if (input.id === 'startDate') {
            input.value = endDate;
            if (!messageShown) {
                showStatus('시작일은 종료일보다 늦을 수 없습니다. 종료일로 조정했습니다.', 'error');
            }
        } else {
            input.value = startDate;
            if (!messageShown) {
                showStatus('종료일은 시작일보다 빠를 수 없습니다. 시작일로 조정했습니다.', 'error');
            }
        }
    }
    
    // 시각적 피드백 적용
    validateAndStyleDateInput(input);
    
    if (messageShown) {
        setTimeout(hideStatus, 3000);
    }
}

// 날짜 입력 제한 함수
function restrictDateInput(event) {
    const input = event.target;
    
    if (!dateRange) return;
    
    // Enter 키나 Tab 키 등은 허용
    if (['Enter', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 
         'Backspace', 'Delete', 'Home', 'End'].includes(event.key)) {
        return;
    }
    
    // 복사/붙여넣기 허용
    if (event.ctrlKey || event.metaKey) {
        return;
    }
    
    // 현재 입력값이 범위를 벗어나는지 실시간 검사
    setTimeout(() => {
        validateAndStyleDateInput(input);
    }, 10);
}

// 날짜 입력 필드 초기화 함수
function initializeDateInputs() {
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    
    if (!startDateInput || !endDateInput) return;
    
    // 이벤트 리스너 추가
    const inputEvents = ['input', 'change', 'blur'];
    const keyboardEvents = ['keydown', 'keyup'];
    
    inputEvents.forEach(eventType => {
        startDateInput.addEventListener(eventType, validateDateRange);
        endDateInput.addEventListener(eventType, validateDateRange);
    });
    
    keyboardEvents.forEach(eventType => {
        startDateInput.addEventListener(eventType, restrictDateInput);
        endDateInput.addEventListener(eventType, restrictDateInput);
    });
    
    // 캘린더 팝업에서 범위 밖 날짜 클릭 방지
    startDateInput.addEventListener('click', preventOutOfRangeSelection);
    endDateInput.addEventListener('click', preventOutOfRangeSelection);
    
    // 초기 유효성 검사
    validateAndStyleDateInput(startDateInput);
    validateAndStyleDateInput(endDateInput);
}

// 범위 밖 날짜 선택 방지
function preventOutOfRangeSelection(event) {
    const input = event.target;
    
    if (!dateRange) return;
    
    setTimeout(() => {
        if (input.value && (input.value < dateRange.start || input.value > dateRange.end)) {
            const adjustedValue = input.value < dateRange.start ? dateRange.start : dateRange.end;
            input.value = adjustedValue;
            validateAndStyleDateInput(input);
            showStatus(`선택한 날짜가 허용 범위를 벗어나므로 ${adjustedValue}로 조정했습니다.`, 'error');
            setTimeout(hideStatus, 3000);
        }
    }, 100);
}

// 날짜 범위 가져오기
async function fetchDateRange() {
    try {
        const response = await fetch('/api/date-range');
        if (response.ok) {
            const data = await response.json();
            dateRange = data;
            
            // 날짜 입력 필드에 min/max 설정
            const startDateInput = document.getElementById('startDate');
            const endDateInput = document.getElementById('endDate');
            
            if (startDateInput && endDateInput) {
                startDateInput.min = data.start;
                startDateInput.max = data.end;
                endDateInput.min = data.start;
                endDateInput.max = data.end;
                
                // 현재 값이 범위를 벗어난 경우 조정
                if (startDateInput.value && (startDateInput.value < data.start || startDateInput.value > data.end)) {
                    startDateInput.value = data.start;
                    showStatus(`시작일이 허용 범위를 벗어나서 ${data.start}로 조정했습니다.`, 'error');
                }
                if (endDateInput.value && (endDateInput.value < data.start || endDateInput.value > data.end)) {
                    endDateInput.value = data.end;
                    showStatus(`종료일이 허용 범위를 벗어나서 ${data.end}로 조정했습니다.`, 'error');
                }
                
                // 날짜 입력 필드 초기화
                initializeDateInputs();
            }
            
            console.log(`날짜 범위 설정: ${data.start} ~ ${data.end}`);
            return data;
        }
    } catch (error) {
        console.error('날짜 범위 가져오기 실패:', error);
        showStatus('날짜 범위를 가져오는 중 오류가 발생했습니다. 기본값을 사용합니다.', 'error');
        setTimeout(hideStatus, 3000);
        // 실패 시 기본값 사용
        const defaultRange = { start: '2025-07-26', end: '2025-09-24' };
        dateRange = defaultRange;
        
        const startDateInput = document.getElementById('startDate');
        const endDateInput = document.getElementById('endDate');
        
        if (startDateInput && endDateInput) {
            startDateInput.min = defaultRange.start;
            startDateInput.max = defaultRange.end;
            endDateInput.min = defaultRange.start;
            endDateInput.max = defaultRange.end;
            
            initializeDateInputs();
        }
        
        return defaultRange;
    }
}

// 상태 표시 함수
function showStatus(message, type) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = `status ${type}`;
}

function hideStatus() {
    document.getElementById('status').className = 'status';
}

// 카운터 애니메이션
function animateCounter(elementId, targetValue) {
    const element = document.getElementById(elementId);
    const startValue = parseInt(element.textContent) || 0;
    const duration = 1500;
    const startTime = Date.now();

    function updateCounter() {
        const elapsedTime = Date.now() - startTime;
        const progress = Math.min(elapsedTime / duration, 1);
        const currentValue = Math.floor(startValue + (targetValue - startValue) * progress);
        element.textContent = currentValue.toLocaleString();

        if (progress < 1) requestAnimationFrame(updateCounter);
    }
    updateCounter();
}

// 툴팁 표시
function showTooltip(event, element) {
    const tooltip = document.getElementById('tooltip');
    const channelData = JSON.parse(element.getAttribute('data-channel'));
    const severityLabel = getSeverityLabel(currentSeverityFilter);

    let tooltipContent = `
        <div class="tooltip-title">${channelData.name || `CH${channelData.channel_id.padStart(2, '0')}`} 상세 정보</div>
        <div class="tooltip-item">
            <span>${severityLabel} 이벤트:</span>
            <strong>${channelData.count}건</strong>
        </div>
    `;

    if (channelData.by_type && channelData.by_type.length > 0) {
        channelData.by_type.forEach(eventType => {
            tooltipContent += `
                <div class="tooltip-item">
                    <span>${eventType.label}:</span>
                    <strong>${eventType.count}건</strong>
                </div>
            `;
        });
    }

    tooltip.innerHTML = tooltipContent;
    tooltip.style.display = 'block';
    tooltip.style.opacity = '1';
    moveTooltip(event);
}

function hideTooltip() {
    const tooltip = document.getElementById('tooltip');
    tooltip.style.display = 'none';
    tooltip.style.opacity = '0';
}

function moveTooltip(event) {
    const tooltip = document.getElementById('tooltip');
    if (!tooltip || tooltip.style.display === 'none') return;

    const tooltipRect = tooltip.getBoundingClientRect();
    let x = event.pageX + 15;
    let y = event.pageY + 15;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    if (x - scrollX + tooltipRect.width > viewportWidth - 20) {
        x = event.pageX - tooltipRect.width - 15;
    }

    if (y - scrollY + tooltipRect.height > viewportHeight - 20) {
        y = event.pageY - tooltipRect.height - 15;
    }

    x = Math.max(scrollX + 10, x);
    y = Math.max(scrollY + 10, y);

    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
}

// ========== UI 개선 기능들 ==========

// 이미지 확대 기능
function enableImageZoom() {
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('emap-image') || e.target.classList.contains('fov-image')) {
            e.preventDefault();
            zoomImage(e.target);
        }
    });
}

function zoomImage(img) {
    if (img.classList.contains('enlarged')) {
        closeImageZoom();
        return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'image-overlay';
    overlay.onclick = closeImageZoom;

    const enlargedImg = img.cloneNode(true);
    enlargedImg.classList.add('enlarged');
    enlargedImg.onclick = closeImageZoom;

    document.body.appendChild(overlay);
    document.body.appendChild(enlargedImg);

    document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape') {
            closeImageZoom();
            document.removeEventListener('keydown', escHandler);
        }
    });
}

function closeImageZoom() {
    const overlay = document.querySelector('.image-overlay');
    const enlargedImg = document.querySelector('.emap-image.enlarged, .fov-image.enlarged');

    if (overlay) overlay.remove();
    if (enlargedImg) enlargedImg.remove();
}

// 키보드 접근성 개선
function enableKeyboardNavigation() {
    document.addEventListener('keydown', function(e) {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('channel-card')) {
            e.preventDefault();
            const channelId = e.target.getAttribute('data-channel-id');
            if (channelId) {
                openChannelModal(channelId);
            }
        }

        if (e.key === 'Escape') {
            const modal = document.getElementById('channelModal');
            if (modal.style.display === 'block') {
                closeModal();
            }
            closeImageZoom();
        }
    });
}

function updateChannelCardAccessibility() {
    const channelCards = document.querySelectorAll('.channel-card[data-channel-id]');
    channelCards.forEach(card => {
        card.setAttribute('tabindex', '0');
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', `채널 ${card.getAttribute('data-channel-id')} 상세 정보 보기`);
    });
}

// 오류 처리 개선
function handleImageError(img, container, altText) {
    container.innerHTML = `
        <div class="image-error">
            ${altText} 이미지를 불러올 수 없습니다
            <small style="margin-top: 8px; opacity: 0.7;">네트워크 연결 또는 파일 경로를 확인해주세요</small>
        </div>
    `;
}

// ========== 모달 업데이트 함수들 ==========

// 모달 상세 정보 섹션 업데이트
function updateModalDetailSection(channelData, chStr, severityLabel) {
    const detailContent = document.getElementById('detailContent');
    const counts = channelData.counts || { total: 0, critical: 0, warn: 0, info: 0 };

    let detailHtml = `
        <div class="detail-item">
            <span>${severityLabel} 이벤트:</span>
            <strong>${counts.total}건</strong>
        </div>
        <div class="detail-item">
            <span>Critical:</span>
            <strong>${counts.critical}건</strong>
        </div>
        <div class="detail-item">
            <span>Warning:</span>
            <strong>${counts.warn}건</strong>
        </div>
        <div class="detail-item">
            <span>Info:</span>
            <strong>${counts.info}건</strong>
        </div>
    `;

    // 이벤트 타입별 상세 정보
    if (channelData.by_type && channelData.by_type.length > 0) {
        detailHtml += `<div style="border-top: 1px solid #dee2e6; margin: 15px 0; padding-top: 15px;"></div>`;
        channelData.by_type.forEach(eventType => {
            detailHtml += `
                <div class="detail-item">
                    <span>${eventType.label || eventType.type_name || eventType.type_code}:</span>
                    <strong>${eventType.count}건</strong>
                </div>
            `;
        });
    }

    detailContent.innerHTML = detailHtml;
}

function updateModalLocationSection(channelData, chStr) {
    const locationInfo = document.getElementById('locationInfo');
    locationInfo.innerHTML = `
        <div class="location-item">
            <h4>채널 번호</h4>
            <p>${chStr}</p>
        </div>
        <div class="location-item">
            <h4>설비명</h4>
            <p>${channelData.fov_location_name || '정보 없음'}</p>
        </div>
        <div class="location-item">
            <h4>공정명</h4>
            <p>${channelData.area_name || '정보 없음'}</p>
        </div>
        <div class="location-item">
            <h4>상태</h4>
            <p>${channelData.status || 'OFF'}</p>
        </div>
    `;
}

function updateModalImageSections(channelData, chStr) {
    const emapContainer = document.getElementById('emapContainer');
    const fovContainer = document.getElementById('fovContainer');

    // E-MAP 이미지 표시
    if (channelData.emap_image_url) {
        const emapImageUrl = `/static/emap/${channelData.emap_image_url}`;
        emapContainer.innerHTML = `
            <img src="${emapImageUrl}" 
                 alt="E-MAP" 
                 class="emap-image" 
                 style="width: 100%; height: 100%; object-fit: contain;"
                 onerror="this.parentElement.innerHTML='<div class=\\"placeholder\\">E-MAP 이미지를 불러올 수 없습니다</div>'">
        `;
    } else {
        emapContainer.innerHTML = `
            <div class="placeholder">
                E-MAP 이미지 없음<br>
                <small>${chStr}</small>
            </div>
        `;
    }

    // FOV 썸네일 이미지 표시
    if (channelData.fov_thumbnail_url) {
        const fovImageUrl = `/static/fov_thumbnails/${channelData.fov_thumbnail_url}`;
        fovContainer.innerHTML = `
            <img src="${fovImageUrl}" 
                 alt="FOV 썸네일" 
                 class="fov-image" 
                 style="width: 100%; height: 100%; object-fit: contain;"
                 onerror="this.parentElement.innerHTML='<div class=\\"placeholder\\">FOV 이미지를 불러올 수 없습니다</div>'">
        `;
    } else {
        fovContainer.innerHTML = `
            <div class="placeholder">
                <strong>${channelData.fov_location_name || chStr}</strong><br>
                FOV 썸네일 없음
            </div>
        `;
    }
}

function updateModalArchiveSection(channelData, chStr, severityLabel) {
    const archiveTitle = document.getElementById('archiveTitle');
    const archiveContent = document.getElementById('archiveContent');

    archiveTitle.textContent = `${chStr} 이벤트 로그 현황 아카이브 - ${severityLabel}`;
    
    let archiveHtml = '';

    if (channelData.by_type && channelData.by_type.length > 0) {
        channelData.by_type.forEach(eventType => {
            archiveHtml += `
                <div class="archive-item">
                    <h4 class="archive-subtitle">${eventType.label || eventType.type_name || eventType.type_code} (${eventType.count}건)</h4>
                    <div class="detail-item">
                        <span>발생 건수:</span>
                        <strong>${eventType.count}건</strong>
                    </div>
                    <div class="detail-item">
                        <span>타입 코드:</span>
                        <strong>${eventType.type_code || 'N/A'}</strong>
                    </div>
                </div>
            `;
        });
    } else {
        const range = channelData.range || { start: 'N/A', end: 'N/A' };
        const counts = channelData.counts || { total: 0 };
        
        archiveHtml = `
            <div class="archive-item">
                <h4 class="archive-subtitle">표시할 이벤트 아카이브가 없습니다</h4>
                <div class="detail-item">
                    <span>기간:</span>
                    <strong>${range.start} ~ ${range.end}</strong>
                </div>
                <div class="detail-item">
                    <span>총 이벤트:</span>
                    <strong>${counts.total}건</strong>
                </div>
            </div>
        `;
    }

    archiveContent.innerHTML = archiveHtml;
}
